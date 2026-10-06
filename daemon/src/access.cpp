#include "access.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <fstream>
#include <regex>
#include <stdexcept>

namespace {
std::string randomHex(size_t bytes) {
  std::array<unsigned char, 32> buffer{};
  std::ifstream random("/dev/urandom", std::ios::binary);
  if (!random.read(reinterpret_cast<char*>(buffer.data()), static_cast<std::streamsize>(bytes))) throw std::runtime_error("Secure random source unavailable");
  const char* hex = "0123456789abcdef"; std::string result;
  for (size_t i = 0; i < bytes; i++) { result += hex[buffer[i] >> 4]; result += hex[buffer[i] & 15]; }
  return result;
}
bool equal(const std::string& a, const std::string& b) {
  if (a.size() != b.size()) return false;
  unsigned char difference = 0;
  for (size_t i = 0; i < a.size(); i++) difference |= static_cast<unsigned char>(a[i] ^ b[i]);
  return difference == 0;
}
}

Access::Access(std::vector<std::string> origins) : origins_(std::move(origins)), code_(randomHex(6)), attemptWindow_(std::chrono::steady_clock::now()) {
  const std::regex secure("^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?$");
  const std::regex local("^http://(127\\.0\\.0\\.1|localhost)(:[0-9]{1,5})?$");
  for (const auto& origin : origins_) if (!std::regex_match(origin, secure) && !std::regex_match(origin, local)) throw std::runtime_error("Approved sites must be exact HTTPS origins (or HTTP localhost for development): " + origin);
}
bool Access::allows(const std::string& origin) const { return std::find(origins_.begin(), origins_.end(), origin) != origins_.end(); }
bool Access::authorized(const std::string& origin, const std::string& authorization) {
  if (!allows(origin) || authorization.rfind("Bearer ", 0) != 0) return false;
  const auto token = authorization.substr(7);
  std::lock_guard<std::mutex> lock(mutex_);
  const auto found = sessions_.find(token);
  return found != sessions_.end() && found->second.origin == origin && found->second.expires > std::chrono::steady_clock::now();
}
bool Access::revoke(const std::string& origin, const std::string& authorization) {
  if (!allows(origin) || authorization.rfind("Bearer ", 0) != 0) return false;
  std::lock_guard<std::mutex> lock(mutex_);
  const auto found = sessions_.find(authorization.substr(7));
  if (found == sessions_.end() || found->second.origin != origin) return false;
  sessions_.erase(found); return true;
}
std::pair<int, std::string> Access::pair(const std::string& origin, const std::string& code) {
  if (!allows(origin)) return {403, ""};
  std::lock_guard<std::mutex> lock(mutex_);
  const auto now = std::chrono::steady_clock::now();
  if (now - attemptWindow_ >= std::chrono::minutes(1)) { failures_ = 0; attemptWindow_ = now; }
  if (failures_ >= 5) return {429, ""};
  std::string normalized = code;
  std::transform(normalized.begin(), normalized.end(), normalized.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  if (!equal(normalized, code_)) { failures_++; return {401, ""}; }
  for (auto it = sessions_.begin(); it != sessions_.end();) { if (it->second.expires <= now) it = sessions_.erase(it); else ++it; }
  if (sessions_.size() >= 32) return {429, ""};
  const auto token = randomHex(32);
  sessions_[token] = {origin, now + std::chrono::hours(12)};
  return {200, token};
}
