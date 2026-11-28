// Afterlife Wi-Fi Sense: CoreWLAN link reader.
//
// Prints one JSON line per reading of this Mac's own Wi-Fi link to stdout:
//   {"t": <ms since epoch>, "rssi": <dBm>, "noise": <dBm>, "txRate": <Mbps>, "iface": "en0"}
// or, when there is no interface or it isn't associated:
//   {"t": <ms since epoch>, "error": "not_connected"}
//
// It reads only RSSI, noise and transmit rate. It never reads the SSID or BSSID (which
// macOS gates behind Location permission), never scans, and sends nothing anywhere.
//
// Normally compiled and spawned by collector.mjs. To run it by hand:
//   swiftc -O scripts/wifi-sense/rssi.swift -o /tmp/wifi-sense-rssi
//   /tmp/wifi-sense-rssi --interval-ms 50

import CoreWLAN
import Foundation

let defaultIntervalMs = 50
let minIntervalMs = 5

func parseIntervalMs() -> Int {
  let args = CommandLine.arguments
  if let flag = args.firstIndex(of: "--interval-ms"), flag + 1 < args.count,
    let value = Int(args[flag + 1]), value >= minIntervalMs
  {
    return value
  }
  return defaultIntervalMs
}

// Exit cleanly on Ctrl-C or kill. The handlers can't capture context, so they just exit.
signal(SIGINT) { _ in exit(0) }
signal(SIGTERM) { _ in exit(0) }
// When the reader closes the pipe, fputs fails instead of the process being killed.
signal(SIGPIPE, SIG_IGN)

func emit(_ line: String) {
  if fputs(line + "\n", stdout) == EOF || fflush(stdout) != 0 {
    exit(0)
  }
}

func nowMs() -> Int64 {
  return Int64((Date().timeIntervalSince1970 * 1000).rounded())
}

func escapeJson(_ s: String) -> String {
  var out = ""
  for ch in s.unicodeScalars {
    switch ch {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    default:
      if ch.value < 0x20 {
        out += String(format: "\\u%04x", ch.value)
      } else {
        out.unicodeScalars.append(ch)
      }
    }
  }
  return out
}

let intervalUs = useconds_t(parseIntervalMs() * 1000)
let client = CWWiFiClient.shared()

while true {
  let t = nowMs()
  if let iface = client.interface() {
    let rssi = iface.rssiValue()
    if rssi == 0 {
      emit("{\"t\":\(t),\"error\":\"not_connected\"}")
    } else {
      let noise = iface.noiseMeasurement()
      let txRate = iface.transmitRate()
      let name = escapeJson(iface.interfaceName ?? "")
      emit(
        "{\"t\":\(t),\"rssi\":\(rssi),\"noise\":\(noise),\"txRate\":\(txRate),\"iface\":\"\(name)\"}"
      )
    }
  } else {
    emit("{\"t\":\(t),\"error\":\"not_connected\"}")
  }
  usleep(intervalUs)
}
