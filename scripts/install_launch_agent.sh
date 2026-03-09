#!/bin/zsh

set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
launch_agents_dir="$HOME/Library/LaunchAgents"
label="ai.openclaw.cluster-console"
plist_path="$launch_agents_dir/$label.plist"
log_dir="$project_dir/runtime"
stdout_log="$log_dir/cluster-console.stdout.log"
stderr_log="$log_dir/cluster-console.stderr.log"

mkdir -p "$launch_agents_dir" "$log_dir"

cat > "$plist_path" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>$label</string>
    <key>WorkingDirectory</key>
    <string>$project_dir</string>
    <key>ProgramArguments</key>
    <array>
      <string>/usr/bin/env</string>
      <string>npm</string>
      <string>start</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
      <key>PORT</key>
      <string>4317</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>$stdout_log</string>
    <key>StandardErrorPath</key>
    <string>$stderr_log</string>
  </dict>
</plist>
PLIST

launchctl unload "$plist_path" >/dev/null 2>&1 || true
launchctl load "$plist_path"

echo "Installed LaunchAgent: $label"
echo "Plist: $plist_path"
echo "Logs: $stdout_log"
