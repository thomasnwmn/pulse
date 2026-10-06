#include "collector.h"
#include <algorithm>
#include <cmath>
#include <cctype>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <thread>
#include <sys/statvfs.h>
#include <sys/utsname.h>
#include <unistd.h>

#ifdef __APPLE__
#include <CoreFoundation/CoreFoundation.h>
#include <IOKit/IOKitLib.h>
#include <libproc.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <mach/processor_info.h>
#include <net/if.h>
#include <ifaddrs.h>
#include <sys/sysctl.h>
#include <sys/proc_info.h>
#else
#include <sys/sysinfo.h>
#endif

namespace {
std::string escape(const std::string& s) {
  std::ostringstream out; out << '"';
  for (unsigned char c : s) {
    if (c == '"' || c == '\\') out << '\\' << c;
    else if (c < 0x20) out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec;
    else out << c;
  }
  out << '"'; return out.str();
}
std::string optional(double value) { if (!std::isfinite(value) || value < 0) return "null"; std::ostringstream out; out << std::fixed << std::setprecision(2) << value; return out.str(); }
double rate(uint64_t current, uint64_t previous, double elapsed) { return current >= previous ? static_cast<double>(current - previous) / elapsed : 0; }
#ifdef __APPLE__
std::string sysString(const char* key) { size_t size = 0; if (sysctlbyname(key, nullptr, &size, nullptr, 0) != 0 || size == 0) return ""; std::string value(size, '\0'); if (sysctlbyname(key, value.data(), &size, nullptr, 0) != 0) return ""; while (!value.empty() && value.back() == '\0') value.pop_back(); return value; }
template<typename T> T sysValue(const char* key) { T value{}; size_t size = sizeof(value); sysctlbyname(key, &value, &size, nullptr, 0); return value; }
uint64_t cfNumber(CFDictionaryRef dictionary, CFStringRef key) { const auto value = CFDictionaryGetValue(dictionary, key); int64_t result = 0; if (value && CFGetTypeID(value) == CFNumberGetTypeID()) CFNumberGetValue(static_cast<CFNumberRef>(value), kCFNumberSInt64Type, &result); return static_cast<uint64_t>(std::max<int64_t>(0, result)); }
#else
std::string readText(const std::filesystem::path& path) { std::ifstream in(path); std::string text; std::getline(in, text); return text; }
double readNumber(const std::filesystem::path& path) { std::ifstream in(path); double value; return in >> value ? value : -1; }
#endif
}

std::string Snapshot::json() const {
  std::ostringstream o; o << std::fixed << std::setprecision(2);
  o << "{\"version\":1,\"timestamp\":" << timestamp << ",\"system\":{\"hostname\":" << escape(hostname) << ",\"platform\":" << escape(platform) << ",\"uptime\":" << uptime << "},\"cpu\":{\"model\":" << escape(cpuModel) << ",\"cores\":" << cores << ",\"usage\":" << cpuUsage << ",\"perCore\":[";
  for (size_t i = 0; i < perCore.size(); i++) { if (i) o << ','; o << perCore[i]; }
  o << "],\"temperature\":" << optional(cpuTemperature) << ",\"frequency\":" << optional(cpuFrequency) << "},\"memory\":{\"total\":" << memoryTotal << ",\"used\":" << memoryUsed << ",\"available\":" << memoryAvailable << ",\"swapUsed\":" << swapUsed << ",\"swapTotal\":" << swapTotal << "},\"gpu\":{\"model\":" << escape(gpuModel) << ",\"usage\":" << optional(gpuUsage) << ",\"temperature\":" << optional(gpuTemperature) << ",\"memoryUsed\":" << optional(gpuMemoryUsed) << ",\"memoryTotal\":" << optional(gpuMemoryTotal) << "},\"storage\":{\"model\":" << escape(diskModel) << ",\"total\":" << diskTotal << ",\"used\":" << diskUsed << ",\"readBytesPerSec\":" << optional(diskRead) << ",\"writeBytesPerSec\":" << optional(diskWrite) << ",\"activity\":" << optional(diskActivity) << ",\"temperature\":" << optional(diskTemperature) << "},\"network\":{\"receivedBytesPerSec\":" << networkReceived << ",\"sentBytesPerSec\":" << networkSent << ",\"interface\":" << escape(networkInterface) << "},\"processes\":[";
  for (size_t i = 0; i < processes.size(); i++) { const auto& p = processes[i]; if (i) o << ','; o << "{\"pid\":" << p.pid << ",\"name\":" << escape(p.name) << ",\"cpu\":" << p.cpu << ",\"memory\":" << p.memory << '}'; }
  o << "]}"; return o.str();
}

Collector::Collector() : previous_(std::chrono::steady_clock::now()) {
  char name[256]{}; gethostname(name, sizeof(name) - 1); hostname_ = name;
  struct utsname os{}; uname(&os);
#ifdef __APPLE__
  platform_ = "macOS " + sysString("kern.osproductversion");
  cpuModel_ = sysString("machdep.cpu.brand_string");
  if (cpuModel_.empty()) cpuModel_ = sysString("hw.model");
#else
  platform_ = std::string("Linux · ") + os.machine;
  std::ifstream info("/proc/cpuinfo"); std::string line;
  while (std::getline(info, line)) { const auto pos = line.find(':'); if (pos != std::string::npos && (line.find("model name") == 0 || line.find("Hardware") == 0)) { cpuModel_ = line.substr(pos + 2); break; } }
  if (cpuModel_.empty()) cpuModel_ = os.machine;
#endif
}

Snapshot Collector::sample() {
  const auto now = std::chrono::steady_clock::now();
  elapsed_ = std::max(.001, std::chrono::duration<double>(now - previous_).count());
  Snapshot s; s.hostname = hostname_; s.platform = platform_; s.cpuModel = cpuModel_;
  s.timestamp = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  cpu(s); memory(s); storage(s); network(s); processes(s); gpu(s);
  previous_ = now; initialized_ = true; return s;
}

void Collector::cpu(Snapshot& s) {
  std::vector<std::pair<uint64_t, uint64_t>> ticks;
#ifdef __APPLE__
  natural_t count = 0; processor_info_array_t info = nullptr; mach_msg_type_number_t infoCount = 0;
  if (host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &count, &info, &infoCount) == KERN_SUCCESS) {
    for (natural_t i = 0; i < count; i++) {
      const auto offset = i * CPU_STATE_MAX;
      const uint64_t active = static_cast<uint32_t>(info[offset + CPU_STATE_USER]) + static_cast<uint64_t>(static_cast<uint32_t>(info[offset + CPU_STATE_SYSTEM])) + static_cast<uint32_t>(info[offset + CPU_STATE_NICE]);
      ticks.emplace_back(active, active + static_cast<uint32_t>(info[offset + CPU_STATE_IDLE]));
    }
    vm_deallocate(mach_task_self(), reinterpret_cast<vm_address_t>(info), infoCount * sizeof(integer_t));
  }
  mach_timebase_info_data_t timebase{}; mach_timebase_info(&timebase);
  s.uptime = static_cast<uint64_t>(static_cast<long double>(mach_continuous_time()) * timebase.numer / timebase.denom / 1e9L);
  const auto frequency = sysValue<uint64_t>("hw.cpufrequency"); if (frequency) s.cpuFrequency = frequency / 1e9;
#else
  std::ifstream stat("/proc/stat"); std::string line;
  while (std::getline(stat, line)) {
    if (line.rfind("cpu", 0) != 0 || line.size() < 4 || !std::isdigit(static_cast<unsigned char>(line[3]))) continue;
    std::istringstream row(line); std::string id; uint64_t user = 0, nice = 0, system = 0, idle = 0, wait = 0, irq = 0, softirq = 0, steal = 0;
    row >> id >> user >> nice >> system >> idle >> wait >> irq >> softirq >> steal;
    const uint64_t active = user + nice + system + irq + softirq + steal;
    ticks.emplace_back(active, active + idle + wait);
  }
  struct sysinfo info{}; if (sysinfo(&info) == 0) s.uptime = info.uptime;
  const double frequency = readNumber("/sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq"); if (frequency > 0) s.cpuFrequency = frequency / 1e6;
  std::error_code ec;
  for (const auto& zone : std::filesystem::directory_iterator("/sys/class/thermal", ec)) {
    const auto type = readText(zone.path() / "type");
    if (type.find("x86_pkg_temp") != std::string::npos || type.find("cpu") != std::string::npos || type.find("soc") != std::string::npos) { const double temperature = readNumber(zone.path() / "temp"); if (temperature > 0 && temperature < 150000) { s.cpuTemperature = temperature / 1000; break; } }
  }
#endif
  s.cores = static_cast<unsigned>(ticks.size());
  uint64_t activeDelta = 0, totalDelta = 0;
  for (size_t i = 0; i < ticks.size(); i++) {
    double usage = 0;
    if (i < cpuTicks_.size() && ticks[i].first >= cpuTicks_[i].first && ticks[i].second > cpuTicks_[i].second) {
      const auto a = ticks[i].first - cpuTicks_[i].first, t = ticks[i].second - cpuTicks_[i].second;
      usage = std::clamp(a * 100.0 / t, 0.0, 100.0); activeDelta += a; totalDelta += t;
    }
    s.perCore.push_back(usage);
  }
  if (totalDelta) s.cpuUsage = std::clamp(activeDelta * 100.0 / totalDelta, 0.0, 100.0);
  cpuTicks_ = std::move(ticks);
}

void Collector::memory(Snapshot& s) {
#ifdef __APPLE__
  s.memoryTotal = sysValue<uint64_t>("hw.memsize");
  vm_statistics64_data_t vm{}; mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
  vm_size_t pageSize = 0; host_page_size(mach_host_self(), &pageSize);
  if (host_statistics64(mach_host_self(), HOST_VM_INFO64, reinterpret_cast<host_info64_t>(&vm), &count) == KERN_SUCCESS) {
    const uint64_t usedPages = static_cast<uint64_t>(vm.active_count) + vm.wire_count + vm.compressor_page_count;
    s.memoryUsed = std::min(s.memoryTotal, usedPages * pageSize);
    s.memoryAvailable = s.memoryTotal - s.memoryUsed;
  }
  const auto swap = sysValue<struct xsw_usage>("vm.swapusage"); s.swapTotal = swap.xsu_total; s.swapUsed = swap.xsu_used;
#else
  std::ifstream in("/proc/meminfo"); std::string line; std::map<std::string, uint64_t> values;
  while (std::getline(in, line)) { std::istringstream row(line); std::string key; uint64_t value; if (row >> key >> value) values[key] = value * 1024; }
  s.memoryTotal = values["MemTotal:"]; s.memoryAvailable = std::min(s.memoryTotal, values["MemAvailable:"]); s.memoryUsed = s.memoryTotal - s.memoryAvailable;
  s.swapTotal = values["SwapTotal:"]; s.swapUsed = s.swapTotal - std::min(s.swapTotal, values["SwapFree:"]);
#endif
}

void Collector::storage(Snapshot& s) {
  struct statvfs volume{};
  if (statvfs("/", &volume) == 0) { s.diskTotal = volume.f_blocks * volume.f_frsize; s.diskUsed = s.diskTotal - std::min(s.diskTotal, static_cast<uint64_t>(volume.f_bavail * volume.f_frsize)); }
  uint64_t read = 0, write = 0, busy = 0; bool found = false;
#ifdef __APPLE__
  // APFS stores user data on a separate volume. Use its capacity when present.
  if (statvfs("/System/Volumes/Data", &volume) == 0) { s.diskTotal = volume.f_blocks * volume.f_frsize; s.diskUsed = s.diskTotal - std::min(s.diskTotal, static_cast<uint64_t>(volume.f_bavail * volume.f_frsize)); s.diskModel = "APFS data volume"; }
  io_iterator_t iterator = IO_OBJECT_NULL;
  if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOBlockStorageDriver"), &iterator) == KERN_SUCCESS) {
    io_object_t device;
    while ((device = IOIteratorNext(iterator))) {
      const auto properties = IORegistryEntryCreateCFProperty(device, CFSTR("Statistics"), kCFAllocatorDefault, 0);
      if (properties && CFGetTypeID(properties) == CFDictionaryGetTypeID()) {
        const auto stats = static_cast<CFDictionaryRef>(properties);
        if (CFDictionaryContainsKey(stats, CFSTR("Bytes (Read)")) && CFDictionaryContainsKey(stats, CFSTR("Bytes (Write)"))) { read += cfNumber(stats, CFSTR("Bytes (Read)")); write += cfNumber(stats, CFSTR("Bytes (Write)")); found = true; }
      }
      if (properties) CFRelease(properties); IOObjectRelease(device);
    }
    IOObjectRelease(iterator);
  }
#else
  std::ifstream in("/proc/diskstats"); std::string line;
  while (std::getline(in, line)) {
    std::istringstream row(line); unsigned major, minor; std::string name; uint64_t reads, readMerges, sectorsRead, readTime, writes, writeMerges, sectorsWritten, writeTime, pending, ioTime;
    if (!(row >> major >> minor >> name >> reads >> readMerges >> sectorsRead >> readTime >> writes >> writeMerges >> sectorsWritten >> writeTime >> pending >> ioTime)) continue;
    if (name.rfind("loop", 0) == 0 || name.rfind("ram", 0) == 0 || name.rfind("dm-", 0) == 0) continue;
    std::error_code ec;
    if (!std::filesystem::exists("/sys/block/" + name, ec)) continue; // Skip partitions to avoid counting twice.
    read += sectorsRead * 512; write += sectorsWritten * 512; busy += ioTime; found = true;
  }
#endif
  if (found) {
    s.diskRead = initialized_ ? rate(read, diskRead_, elapsed_) : 0;
    s.diskWrite = initialized_ ? rate(write, diskWrite_, elapsed_) : 0;
#ifndef __APPLE__
    s.diskActivity = initialized_ ? std::clamp(rate(busy, diskBusy_, elapsed_) / 10, 0.0, 100.0) : 0;
#endif
  }
  diskRead_ = read; diskWrite_ = write; diskBusy_ = busy;
}

void Collector::network(Snapshot& s) {
  uint64_t received = 0, sent = 0;
#ifdef __APPLE__
  struct ifaddrs* interfaces = nullptr;
  if (getifaddrs(&interfaces) == 0) {
    for (auto* current = interfaces; current; current = current->ifa_next) {
      if (!current->ifa_addr || current->ifa_addr->sa_family != AF_LINK || !current->ifa_data || (current->ifa_flags & IFF_LOOPBACK) || !(current->ifa_flags & IFF_UP)) continue;
      const auto* counters = static_cast<struct if_data*>(current->ifa_data);
      received += counters->ifi_ibytes; sent += counters->ifi_obytes;
    }
    freeifaddrs(interfaces);
  }
#else
  std::ifstream in("/proc/net/dev"); std::string line;
  while (std::getline(in, line)) {
    const auto separator = line.find(':'); if (separator == std::string::npos) continue;
    const auto name = line.substr(0, separator); if (name.find("lo") != std::string::npos && name.find_first_not_of(" lo") == std::string::npos) continue;
    std::istringstream row(line.substr(separator + 1)); uint64_t rx = 0, tx = 0, ignored = 0; row >> rx; for (int i = 0; i < 7; i++) row >> ignored; row >> tx; received += rx; sent += tx;
  }
#endif
  s.networkReceived = initialized_ ? rate(received, netReceived_, elapsed_) : 0; s.networkSent = initialized_ ? rate(sent, netSent_, elapsed_) : 0;
  netReceived_ = received; netSent_ = sent;
}

void Collector::processes(Snapshot& s) {
  std::map<int, uint64_t> next;
  const double cores = std::max(1u, s.cores);
#ifdef __APPLE__
  const int bufferSize = proc_listpids(PROC_ALL_PIDS, 0, nullptr, 0);
  if (bufferSize <= 0) return;
  std::vector<pid_t> pids(static_cast<size_t>(bufferSize) / sizeof(pid_t) + 128);
  const int bytesReturned = proc_listpids(PROC_ALL_PIDS, 0, pids.data(), static_cast<int>(pids.size() * sizeof(pid_t)));
  if (bytesReturned <= 0) return;
  for (int i = 0; i < bytesReturned / static_cast<int>(sizeof(pid_t)); i++) {
    const auto pid = pids[i]; if (pid <= 0) continue;
    struct proc_taskinfo task{};
    if (proc_pidinfo(pid, PROC_PIDTASKINFO, 0, &task, sizeof(task)) != sizeof(task)) continue;
    char name[256]{}; if (proc_name(pid, name, sizeof(name)) <= 0) std::strcpy(name, "Process");
    const uint64_t ticks = task.pti_total_user + task.pti_total_system;
    double usage = 0; const auto previous = processTicks_.find(pid);
    if (initialized_ && previous != processTicks_.end()) usage = std::clamp(rate(ticks, previous->second, elapsed_) / 1e9 * 100 / cores, 0.0, 100.0);
    s.processes.push_back({ pid, name, usage, task.pti_resident_size }); next[pid] = ticks;
  }
#else
  const double clockTicks = std::max<long>(1, sysconf(_SC_CLK_TCK)); const auto pageSize = sysconf(_SC_PAGESIZE);
  std::error_code ec;
  for (const auto& entry : std::filesystem::directory_iterator("/proc", ec)) {
    const std::string id = entry.path().filename(); if (id.empty() || id.find_first_not_of("0123456789") != std::string::npos) continue;
    std::ifstream in(entry.path() / "stat"); std::string line; if (!std::getline(in, line)) continue;
    const auto open = line.find('('), close = line.rfind(')'); if (open == std::string::npos || close == std::string::npos) continue;
    const std::string name = line.substr(open + 1, close - open - 1);
    std::istringstream fields(line.substr(close + 2)); std::vector<std::string> values; std::string value; while (fields >> value) values.push_back(value);
    if (values.size() < 22) continue;
    try {
      const int pid = std::stoi(id); const uint64_t ticks = std::stoull(values[11]) + std::stoull(values[12]); const auto rss = std::stoll(values[21]);
      double usage = 0; const auto previous = processTicks_.find(pid);
      if (initialized_ && previous != processTicks_.end()) usage = std::clamp(rate(ticks, previous->second, elapsed_) / clockTicks * 100 / cores, 0.0, 100.0);
      s.processes.push_back({ pid, name, usage, static_cast<uint64_t>(std::max<int64_t>(0, rss)) * static_cast<uint64_t>(pageSize) }); next[pid] = ticks;
    } catch (const std::exception&) { continue; }
  }
#endif
  processTicks_ = std::move(next);
  std::sort(s.processes.begin(), s.processes.end(), [](const Process& a, const Process& b) { return a.cpu == b.cpu ? a.memory > b.memory : a.cpu > b.cpu; });
  if (s.processes.size() > 100) s.processes.resize(100);
}

void Collector::gpu(Snapshot& s) {
#ifdef __APPLE__
  // Public IOKit registry properties vary by hardware. Only expose fields that exist.
  io_iterator_t iterator = IO_OBJECT_NULL;
  if (IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &iterator) != KERN_SUCCESS) return;
  io_object_t device;
  while ((device = IOIteratorNext(iterator))) {
    const auto stats = IORegistryEntryCreateCFProperty(device, CFSTR("PerformanceStatistics"), kCFAllocatorDefault, 0);
    if (stats && CFGetTypeID(stats) == CFDictionaryGetTypeID()) {
      const auto dictionary = static_cast<CFDictionaryRef>(stats);
      if (CFDictionaryContainsKey(dictionary, CFSTR("Device Utilization %"))) s.gpuUsage = std::min(100.0, static_cast<double>(cfNumber(dictionary, CFSTR("Device Utilization %"))));
      if (CFDictionaryContainsKey(dictionary, CFSTR("In use system memory"))) s.gpuMemoryUsed = static_cast<double>(cfNumber(dictionary, CFSTR("In use system memory")));
      s.gpuModel = "Integrated / IOKit graphics";
    }
    if (stats) CFRelease(stats); IOObjectRelease(device);
  }
  IOObjectRelease(iterator);
#else
  std::error_code ec;
  for (const auto& card : std::filesystem::directory_iterator("/sys/class/drm", ec)) {
    const auto name = card.path().filename().string(); if (name.rfind("card", 0) != 0 || name.find('-') != std::string::npos) continue;
    const auto device = card.path() / "device"; const auto usage = readNumber(device / "gpu_busy_percent");
    if (usage >= 0) { s.gpuUsage = std::min(100.0, usage); s.gpuModel = "GPU · " + name; s.gpuMemoryUsed = readNumber(device / "mem_info_vram_used"); s.gpuMemoryTotal = readNumber(device / "mem_info_vram_total"); }
    std::error_code hwEc;
    for (const auto& hwmon : std::filesystem::directory_iterator(device / "hwmon", hwEc)) { const auto temperature = readNumber(hwmon.path() / "temp1_input"); if (temperature > 0 && temperature < 150000) s.gpuTemperature = temperature / 1000; }
    if (s.gpuUsage >= 0) break;
  }
#endif
}
