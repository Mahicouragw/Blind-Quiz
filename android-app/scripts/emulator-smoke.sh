#!/usr/bin/env bash
# Install the signed release APK and make sure its launcher process survives both
# a cold start and an actual emulator reboot. On failure, print and save logcat.
set -Eeuo pipefail

apk_path="${1:?Usage: emulator-smoke.sh <signed-apk> <log-dir>}"
log_dir="${2:?Usage: emulator-smoke.sh <signed-apk> <log-dir>}"
package_name='io.github.mahicouragw.blind_quiz'
activity_component="$package_name/.MainActivity"
mkdir -p "$log_dir"

app_pid() {
  local result
  result="$(adb shell pidof "$package_name" 2>/dev/null | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' || true)"
  printf '%s' "$result"
}

fail_with_logs() {
  local phase="$1"
  local reason="$2"
  local logfile="$log_dir/${phase}-failure.log"
  {
    printf 'Android emulator smoke test failed during: %s\nReason: %s\n' "$phase" "$reason"
    printf '\n=== Device ===\n'
    timeout 15 adb shell getprop ro.build.version.release 2>&1 || true
    timeout 15 adb shell getprop ro.build.version.sdk 2>&1 || true
    printf '\n=== Activity state ===\n'
    timeout 15 adb shell dumpsys activity activities 2>&1 | tail -n 160 || true
    printf '\n=== Crash buffer ===\n'
    timeout 15 adb logcat -b crash -d -v threadtime 2>&1 || true
    printf '\n=== Recent logcat (all buffers) ===\n'
    timeout 15 adb logcat -b all -d -v threadtime -t 2000 2>&1 || true
  } | tee "$logfile"
  if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    {
      printf '### Android emulator smoke test failed\n\n**Phase:** %s  \n**Reason:** %s\n\n' "$phase" "$reason"
      printf '\n#### Crash buffer and relevant logcat\n\n```text\n'
      timeout 15 adb logcat -b crash -d -v threadtime 2>&1 | tail -n 200 || true
      timeout 15 adb logcat -b all -d -v threadtime -t 2000 2>&1 | grep -E 'AndroidRuntime|FATAL EXCEPTION|Fatal signal|Process: io[.]github[.]mahicouragw[.]blind_quiz|io[.]github[.]mahicouragw[.]blind_quiz' | tail -n 200 || true
      printf '\n```\n\nFull logs are also attached as the emulator log artifact.\n'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
  echo "::error title=Android emulator launch failed::$reason (full log: $logfile)"
  exit 1
}

if [[ ! -s "$apk_path" ]]; then
  fail_with_logs install "Signed APK is missing or empty: $apk_path"
fi

printf 'Installing signed APK: %s\n' "$apk_path"
if ! install_output="$(timeout 180 adb install -r "$apk_path" 2>&1)"; then
  printf '%s\n' "$install_output"
  fail_with_logs install "adb install failed: $install_output"
fi
printf '%s\n' "$install_output"

launch_and_watch() {
  local phase="$1"
  local launch_output pid current crash_buffer
  local start_log="$log_dir/${phase}-launch.log"

  adb logcat -c
  timeout 15 adb shell am force-stop "$package_name" >/dev/null 2>&1 || true
  if ! launch_output="$(timeout 60 adb shell am start -W -n "$activity_component" 2>&1)"; then
    printf '%s\n' "$launch_output"
    fail_with_logs "$phase" "ActivityManager could not start $activity_component"
  fi
  printf '%s\n' "$launch_output" | tee "$start_log"
  if grep -Eiq '(^|[[:space:]])Error:|Status:[[:space:]]*timeout|Exception' <<<"$launch_output" || \
      ! grep -Eiq 'Status:[[:space:]]*ok' <<<"$launch_output"; then
    fail_with_logs "$phase" "ActivityManager did not report a successful launch"
  fi

  # Wait for Flutter's process to appear before starting the liveness window.
  pid=''
  for _ in $(seq 1 45); do
    pid="$(app_pid)"
    [[ -n "$pid" ]] && break
    sleep 1
  done
  [[ -n "$pid" ]] || fail_with_logs "$phase" "App process never appeared after launch"
  local first_pid="${pid%% *}"
  printf 'App process started with PID %s; monitoring for 20 seconds.\n' "$first_pid"

  for _ in $(seq 1 20); do
    sleep 1
    current="$(app_pid)"
    [[ -n "$current" ]] || fail_with_logs "$phase" "App process stopped after launch"
    if [[ " $current " != *" $first_pid "* ]]; then
      fail_with_logs "$phase" "App process restarted unexpectedly (initial PID $first_pid; current PID(s): $current)"
    fi
    crash_buffer="$(adb logcat -b crash -d -v threadtime 2>/dev/null || true)"
    if grep -Fq "Process: $package_name," <<<"$crash_buffer" || \
        { grep -Fq "$package_name" <<<"$crash_buffer" && grep -Eiq 'FATAL EXCEPTION|Fatal signal' <<<"$crash_buffer"; }; then
      fail_with_logs "$phase" "Android recorded a fatal crash for $package_name"
    fi
  done

  adb logcat -b crash -d -v threadtime > "$log_dir/${phase}-crash-buffer.log" 2>&1 || true
  adb logcat -b all -d -v threadtime -t 2000 > "$log_dir/${phase}-logcat.log" 2>&1 || true
  printf 'App remained alive for 20 seconds during %s (PID %s).\n' "$phase" "$first_pid"
}

launch_and_watch cold-launch

printf 'Rebooting emulator to verify a post-reboot launch...\n'
timeout 20 adb reboot >/dev/null 2>&1 || true
reboot_observed=false
for _ in $(seq 1 60); do
  device_state="$(adb get-state 2>/dev/null || true)"
  boot_completed="$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  if [[ "$device_state" != 'device' || "$boot_completed" != '1' ]]; then
    reboot_observed=true
    break
  fi
  sleep 1
done
[[ "$reboot_observed" == 'true' ]] || fail_with_logs post-reboot "Emulator did not enter reboot after adb reboot"
if ! timeout 180 adb wait-for-device; then
  fail_with_logs post-reboot "Emulator did not reconnect after reboot"
fi
boot_completed=''
for _ in $(seq 1 180); do
  boot_completed="$(timeout 10 adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
  [[ "$boot_completed" == '1' ]] && break
  sleep 1
done
[[ "$boot_completed" == '1' ]] || fail_with_logs post-reboot "Android did not finish booting within 180 seconds"

launch_and_watch post-reboot
printf 'PASS: signed APK installed, opened, survived cold launch, rebooted, and opened again.\n'
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '### Android emulator smoke test passed\n\n- Signed APK installed successfully.\n- Launcher stayed alive for 20 seconds after cold launch.\n- Emulator rebooted; launcher stayed alive for 20 seconds after relaunch.\n' >> "$GITHUB_STEP_SUMMARY"
fi
