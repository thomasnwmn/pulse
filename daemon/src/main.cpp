#include "collector.h"
#include "access.h"
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <cctype>
#include <condition_variable>
#include <csignal>
#include <cstring>
#include <iostream>
#include <memory>
#include <mutex>
#include <string>
#include <stdexcept>
#include <thread>
#include <vector>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace {
static_assert(std::atomic<bool>::is_always_lock_free, "Signal handling requires lock-free atomics");
std::atomic<bool> running{true};
void stop(int) { running.store(false, std::memory_order_relaxed); }
struct FileDescriptor { int value; ~FileDescriptor() { if (value >= 0) close(value); } };
struct Store { std::mutex mutex; std::condition_variable changed; std::string snapshot; uint64_t generation = 0; };
struct ClientThread { std::thread thread; std::shared_ptr<std::atomic<bool>> done; };
bool sendAll(int fd, const std::string& text) {
  size_t offset = 0;
  while (offset < text.size() && running) {
#ifdef __APPLE__
    const auto count = send(fd, text.data() + offset, text.size() - offset, 0);
#else
    const auto count = send(fd, text.data() + offset, text.size() - offset, MSG_NOSIGNAL);
#endif
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false; offset += static_cast<size_t>(count);
  }
  return offset == text.size();
}
std::string cors(const std::string& origin) { return origin.empty() ? "" : "Access-Control-Allow-Origin: " + origin + "\r\nVary: Origin, Access-Control-Request-Method, Access-Control-Request-Headers\r\n"; }
void respond(int fd, const std::string& status, const std::string& body, const std::string& origin = "") { sendAll(fd, "HTTP/1.1 " + status + "\r\n" + cors(origin) + "Content-Type: application/json\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body); }
std::string lower(std::string value) { std::transform(value.begin(), value.end(), value.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); }); return value; }
std::string header(const std::string& request, const std::string& key) {
  size_t start = request.find("\r\n") + 2;
  while (start < request.size()) {
    const auto end = request.find("\r\n", start); if (end == std::string::npos || end == start) break;
    const auto colon = request.find(':', start);
    if (colon < end && lower(request.substr(start, colon - start)) == key) { auto value = request.substr(colon + 1, end - colon - 1); const auto first = value.find_first_not_of(" \t"); const auto last = value.find_last_not_of(" \t"); return first == std::string::npos ? "" : value.substr(first, last - first + 1); }
    start = end + 2;
  }
  return "";
}
void client(int fd, Store& store, Access& access) {
  FileDescriptor connection{fd};
  struct timeval timeout{2, 0}; setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout)); setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, sizeof(timeout));
#ifdef __APPLE__
  int noPipe = 1; setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &noPipe, sizeof(noPipe));
#endif
  std::string request; char buffer[2048];
  while (request.find("\r\n\r\n") == std::string::npos && request.size() < 8192 && running) { const auto count = recv(fd, buffer, sizeof(buffer), 0); if (count <= 0) return; request.append(buffer, static_cast<size_t>(count)); }
  if (request.size() >= 8192 || request.find("\r\n\r\n") == std::string::npos) { respond(fd, "400 Bad Request", "{\"error\":\"Invalid request\"}"); return; }
  const auto host = header(request, "host");
  const auto origin = header(request, "origin");
  if ((host != "127.0.0.1:8765" && host != "localhost:8765") || (!origin.empty() && !access.allows(origin)) || (origin.empty() && header(request, "sec-fetch-site") == "cross-site")) { respond(fd, "403 Forbidden", "{\"error\":\"This site is not approved\"}"); return; }
  const auto methodEnd = request.find(' '), pathEnd = request.find(' ', methodEnd + 1);
  if (methodEnd == std::string::npos || pathEnd == std::string::npos) { respond(fd, "400 Bad Request", "{}"); return; }
  const auto method = request.substr(0, methodEnd), path = request.substr(methodEnd + 1, pathEnd - methodEnd - 1);
  if (path != "/health" && path != "/pair" && path != "/snapshot" && path != "/events" && path != "/session") { respond(fd, "404 Not Found", "{\"error\":\"Not found\"}", origin); return; }
  const std::string expectedMethod = path == "/pair" ? "POST" : path == "/session" ? "DELETE" : "GET";
  if (method == "OPTIONS") {
    const auto requestedMethod = header(request, "access-control-request-method");
    const auto headers = lower(header(request, "access-control-request-headers"));
    bool permittedHeaders = true; size_t start = 0;
    while (start < headers.size()) { const auto end = headers.find(',', start); auto item = headers.substr(start, end == std::string::npos ? end : end - start); item.erase(std::remove_if(item.begin(), item.end(), [](unsigned char c) { return std::isspace(c); }), item.end()); if (item != "authorization" && item != "content-type") permittedHeaders = false; if (end == std::string::npos) break; start = end + 1; }
    if (origin.empty() || !permittedHeaders || requestedMethod != expectedMethod) { respond(fd, "403 Forbidden", "{\"error\":\"Preflight denied\"}", origin); return; }
    sendAll(fd, "HTTP/1.1 204 No Content\r\n" + cors(origin) + "Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Max-Age: 600\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return;
  }
  if (method != expectedMethod) { respond(fd, "405 Method Not Allowed", "{\"error\":\"Method not allowed\"}", origin); return; }
  if (path == "/pair" && method == "POST") {
    const auto contentLength = header(request, "content-length"); size_t length = 0;
    try { size_t parsed = 0; length = std::stoul(contentLength, &parsed); if (parsed != contentLength.size()) throw std::invalid_argument("length"); } catch (...) { respond(fd, "400 Bad Request", "{\"error\":\"Invalid pairing request\"}", origin); return; }
    if (length > 128 || !header(request, "transfer-encoding").empty() || header(request, "content-type").rfind("text/plain", 0) != 0) { respond(fd, "400 Bad Request", "{\"error\":\"Invalid pairing request\"}", origin); return; }
    const auto bodyStart = request.find("\r\n\r\n") + 4;
    while (request.size() - bodyStart < length && running) { const auto count = recv(fd, buffer, std::min(sizeof(buffer), length - (request.size() - bodyStart)), 0); if (count <= 0) return; request.append(buffer, static_cast<size_t>(count)); }
    const auto result = access.pair(origin, request.substr(bodyStart, length));
    if (result.first == 200) respond(fd, "200 OK", "{\"token\":\"" + result.second + "\",\"expiresIn\":43200}", origin);
    else respond(fd, result.first == 429 ? "429 Too Many Requests" : result.first == 403 ? "403 Forbidden" : "401 Unauthorized", "{\"error\":\"Pairing failed. Check the code or wait a minute before retrying.\"}", origin);
    return;
  }
  if (path == "/session" && method == "DELETE") { const bool revoked = access.revoke(origin, header(request, "authorization")); respond(fd, revoked ? "200 OK" : "401 Unauthorized", revoked ? "{\"ok\":true}" : "{}", origin); return; }
  if (method != "GET") { respond(fd, "405 Method Not Allowed", "{\"error\":\"Method not allowed\"}", origin); return; }
  if (path == "/health") { respond(fd, "200 OK", "{\"ok\":true,\"version\":1,\"pairingRequired\":true}", origin); return; }
  if (!access.authorized(origin, header(request, "authorization"))) { respond(fd, "401 Unauthorized", "{\"error\":\"Pair this browser with Pulse Companion\"}", origin); return; }
  if (path == "/snapshot") { std::string snapshot; { std::lock_guard<std::mutex> lock(store.mutex); snapshot = store.snapshot; } respond(fd, "200 OK", snapshot, origin); return; }
  if (!sendAll(fd, "HTTP/1.1 200 OK\r\n" + cors(origin) + "Content-Type: text/event-stream\r\nCache-Control: no-cache, no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n")) return;
  uint64_t generation = 0;
  while (running) {
    std::string snapshot;
    { std::unique_lock<std::mutex> lock(store.mutex); store.changed.wait_for(lock, std::chrono::seconds(2), [&] { return !running || store.generation != generation; }); if (!running) break; if (store.generation == generation) continue; generation = store.generation; snapshot = store.snapshot; }
    if (!access.authorized(origin, header(request, "authorization"))) break;
    if (!sendAll(fd, "data: " + snapshot + "\n\n")) break;
  }
}
}

int main(int argc, char** argv) {
  std::vector<std::string> origins;
  bool exitWithParent = false;
  const auto parent = getppid();
  for (int i = 1; i < argc; i++) {
    const std::string arg = argv[i];
    if (arg == "--once") { Collector collector; collector.sample(); std::this_thread::sleep_for(std::chrono::milliseconds(200)); std::cout << collector.sample().json() << '\n'; return 0; }
    if (arg == "--allow-origin" && i + 1 < argc) { origins.push_back(argv[++i]); continue; }
    if (arg == "--exit-with-parent") { exitWithParent = true; continue; }
    std::cout << "Usage: telemetryd [--once] [--allow-origin https://your-site.example]\nHTTP: 127.0.0.1:8765/{health,pair,snapshot,events,session}\n"; return arg == "--help" ? 0 : 1;
  }
  if (origins.empty()) origins = {"http://127.0.0.1:3000", "http://localhost:3000"};
  std::unique_ptr<Access> access;
  try { access = std::make_unique<Access>(origins); } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
  std::signal(SIGINT, stop); std::signal(SIGTERM, stop); std::signal(SIGPIPE, SIG_IGN);
  FileDescriptor listener{socket(AF_INET, SOCK_STREAM, 0)};
  if (listener.value < 0) { std::cerr << "Cannot create socket: " << std::strerror(errno) << '\n'; return 1; }
  int reuse = 1; setsockopt(listener.value, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
  sockaddr_in address{}; address.sin_family = AF_INET; address.sin_port = htons(8765); inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
  if (bind(listener.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) != 0 || listen(listener.value, 16) != 0) { std::cerr << "Cannot listen on 127.0.0.1:8765: " << std::strerror(errno) << '\n'; return 1; }
  Store store; Collector collector; store.snapshot = collector.sample().json(); store.generation = 1;
  std::thread sampler([&] { while (running) { for (int i = 0; i < 10 && running; i++) std::this_thread::sleep_for(std::chrono::milliseconds(100)); if (exitWithParent && getppid() != parent) { running = false; store.changed.notify_all(); } if (!running) break; auto snapshot = collector.sample().json(); { std::lock_guard<std::mutex> lock(store.mutex); store.snapshot = std::move(snapshot); store.generation++; } store.changed.notify_all(); } });
  std::cout << "telemetryd listening on http://127.0.0.1:8765\nPAIRING_CODE: " << access->code() << "\nApproved sites:";
  for (const auto& origin : access->origins()) std::cout << ' ' << origin;
  std::cout << "\n1s sampling · loopback only · paired browsers only\n" << std::flush;
  std::vector<ClientThread> clients;
  while (running) {
    for (auto it = clients.begin(); it != clients.end();) { if (it->done->load()) { it->thread.join(); it = clients.erase(it); } else ++it; }
    struct pollfd ready{listener.value, POLLIN, 0}; if (poll(&ready, 1, 250) <= 0) continue;
    const int fd = accept(listener.value, nullptr, nullptr); if (fd < 0) continue;
    if (clients.size() >= 16) { FileDescriptor rejected{fd}; respond(fd, "503 Service Unavailable", "{\"error\":\"Client limit reached\"}"); continue; }
    auto done = std::make_shared<std::atomic<bool>>(false);
    clients.push_back({ std::thread([fd, &store, &access, done] { try { client(fd, store, *access); } catch (...) { /* fd is closed by the client guard */ } done->store(true); }), done });
  }
  store.changed.notify_all(); sampler.join(); for (auto& c : clients) c.thread.join();
  std::cout << "telemetryd stopped\n"; return 0;
}
