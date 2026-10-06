#pragma once
#include <chrono>
#include <map>
#include <mutex>
#include <string>
#include <vector>

class Access {
 public:
  explicit Access(std::vector<std::string> origins);
  bool allows(const std::string& origin) const;
  bool authorized(const std::string& origin, const std::string& authorization);
  bool revoke(const std::string& origin, const std::string& authorization);
  // Returns HTTP status and token. Pairing codes never appear in HTTP responses.
  std::pair<int, std::string> pair(const std::string& origin, const std::string& code);
  const std::string& code() const { return code_; }
  const std::vector<std::string>& origins() const { return origins_; }
 private:
  struct Session { std::string origin; std::chrono::steady_clock::time_point expires; };
  std::vector<std::string> origins_;
  std::string code_;
  std::mutex mutex_;
  std::map<std::string, Session> sessions_;
  std::chrono::steady_clock::time_point attemptWindow_;
  unsigned failures_ = 0;
};
