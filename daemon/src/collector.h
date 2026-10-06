#pragma once
#include <chrono>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

struct Process { int pid; std::string name; double cpu; uint64_t memory; };
struct Snapshot {
  std::string hostname, platform, cpuModel, gpuModel = "Unavailable", diskModel = "System volume", networkInterface = "Active interfaces";
  uint64_t timestamp = 0, uptime = 0, memoryTotal = 0, memoryUsed = 0, memoryAvailable = 0, swapUsed = 0, swapTotal = 0, diskTotal = 0, diskUsed = 0;
  unsigned cores = 0;
  double cpuUsage = 0, cpuTemperature = -1, cpuFrequency = -1, gpuUsage = -1, gpuTemperature = -1, gpuMemoryUsed = -1, gpuMemoryTotal = -1, diskRead = -1, diskWrite = -1, diskActivity = -1, diskTemperature = -1, networkReceived = 0, networkSent = 0;
  std::vector<double> perCore;
  std::vector<Process> processes;
  std::string json() const;
};

class Collector {
 public:
  Collector();
  Snapshot sample();
 private:
  std::string hostname_, platform_, cpuModel_;
  std::vector<std::pair<uint64_t, uint64_t>> cpuTicks_;
  std::map<int, uint64_t> processTicks_;
  std::chrono::steady_clock::time_point previous_;
  uint64_t netReceived_ = 0, netSent_ = 0, diskRead_ = 0, diskWrite_ = 0, diskBusy_ = 0;
  bool initialized_ = false;
  double elapsed_ = 1;
  void cpu(Snapshot&);
  void memory(Snapshot&);
  void storage(Snapshot&);
  void network(Snapshot&);
  void processes(Snapshot&);
  void gpu(Snapshot&);
};
