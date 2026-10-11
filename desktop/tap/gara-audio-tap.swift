// gara-audio-tap — システム音声を特定アプリ除外で取得する CoreAudio プロセスタップ (macOS 14.2+)
//
// 使い方: gara-audio-tap [除外するバンドルIDの部分文字列]...   (省略時 "discord")
// 出力:   stdout 1 行目 = JSON ヘッダ {"rate":48000,"ch":2}
//         以降 = Float32 インターリーブ PCM の生ストリーム
// 除外対象プロセスの起動・再起動を 3 秒ごとに監視し、タップを自動で組み直す。
// stdout が閉じられたら (読み手の切断 = SIGPIPE) そのまま終了する。
import Foundation
import CoreAudio
import AudioToolbox

let excludeKeys: [String] = CommandLine.arguments.count > 1
    ? Array(CommandLine.arguments.dropFirst()).map { $0.lowercased() }
    : ["discord"]

func err(_ s: String){ FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

// 除外対象のプロセス AudioObjectID を列挙 (バンドルID部分一致)
func findExcluded() -> [AudioObjectID] {
    var addr = AudioObjectPropertyAddress(mSelector: kAudioHardwarePropertyProcessObjectList,
        mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size) == noErr else { return [] }
    var procs = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(AudioObjectID(kAudioObjectSystemObject), &addr, 0, nil, &size, &procs) == noErr else { return [] }
    var out: [AudioObjectID] = []
    for p in procs {
        var baddr = AudioObjectPropertyAddress(mSelector: kAudioProcessPropertyBundleID,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var bsize = UInt32(MemoryLayout<CFString?>.size)
        var bid: Unmanaged<CFString>? = nil
        let st = withUnsafeMutablePointer(to: &bid) { ptr in
            AudioObjectGetPropertyData(p, &baddr, 0, nil, &bsize, ptr)
        }
        if st == noErr, let b = bid?.takeRetainedValue() as String? {
            let lb = b.lowercased()
            if excludeKeys.contains(where: { lb.contains($0) }) { out.append(p) }
        }
    }
    return out.sorted()
}

final class Tap {
    var tapID = AudioObjectID(kAudioObjectUnknown)
    var aggID = AudioObjectID(kAudioObjectUnknown)
    var procID: AudioDeviceIOProcID? = nil
    var channels: UInt32 = 2

    // stdout への書き出し (IOProc スレッドから直接。詰まっても自分の集約デバイスにしか影響しない)
    static func writeSamples(_ abl: UnsafeMutableAudioBufferListPointer, channels: UInt32){
        if abl.count == 1, let d = abl[0].mData {
            // インターリーブ済み → そのまま
            fwrite(d, 1, Int(abl[0].mDataByteSize), stdout)
        } else if abl.count >= 2, let l = abl[0].mData, let r = abl[1].mData {
            // 非インターリーブ (ch別バッファ) → インターリーブして書く
            let n = Int(abl[0].mDataByteSize) / MemoryLayout<Float>.size
            let lp = l.bindMemory(to: Float.self, capacity: n)
            let rp = r.bindMemory(to: Float.self, capacity: n)
            var buf = [Float](repeating: 0, count: n * 2)
            for i in 0..<n { buf[i*2] = lp[i]; buf[i*2+1] = rp[i] }
            buf.withUnsafeBytes { _ = fwrite($0.baseAddress, 1, $0.count, stdout) }
        }
        if ferror(stdout) != 0 { exit(0) }   // 読み手切断
    }

    func start(excluding: [AudioObjectID]) -> Bool {
        let desc = CATapDescription(stereoGlobalTapButExcludeProcesses: excluding)
        desc.isPrivate = true
        desc.muteBehavior = CATapMuteBehavior.unmuted
        var st = AudioHardwareCreateProcessTap(desc, &tapID)
        guard st == noErr else { err("createTap err \(st)"); return false }

        let aggDict: [String: Any] = [
            kAudioAggregateDeviceNameKey as String: "gara-audio-tap",
            kAudioAggregateDeviceUIDKey as String: UUID().uuidString,
            kAudioAggregateDeviceIsPrivateKey as String: true,
            kAudioAggregateDeviceIsStackedKey as String: false,
            kAudioAggregateDeviceTapAutoStartKey as String: true,
            kAudioAggregateDeviceSubDeviceListKey as String: [] as [[String: Any]],
            kAudioAggregateDeviceTapListKey as String: [[kAudioSubTapUIDKey as String: desc.uuid.uuidString]],
        ]
        st = AudioHardwareCreateAggregateDevice(aggDict as CFDictionary, &aggID)
        guard st == noErr else { err("createAgg err \(st)"); stop(); return false }

        var faddr = AudioObjectPropertyAddress(mSelector: kAudioTapPropertyFormat,
            mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain)
        var fsize = UInt32(MemoryLayout<AudioStreamBasicDescription>.size)
        var asbd = AudioStreamBasicDescription()
        AudioObjectGetPropertyData(tapID, &faddr, 0, nil, &fsize, &asbd)
        channels = max(1, asbd.mChannelsPerFrame)
        self.rate = asbd.mSampleRate

        let ch = channels
        st = AudioDeviceCreateIOProcIDWithBlock(&procID, aggID, nil) { _, inData, _, _, _ in
            let abl = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: inData))
            Tap.writeSamples(abl, channels: ch)
        }
        guard st == noErr, let pid = procID else { err("ioproc err \(st)"); stop(); return false }
        st = AudioDeviceStart(aggID, pid)
        guard st == noErr else { err("start err \(st)"); stop(); return false }
        return true
    }
    var rate: Float64 = 48000

    func stop(){
        if let pid = procID, aggID != kAudioObjectUnknown {
            AudioDeviceStop(aggID, pid)
            AudioDeviceDestroyIOProcID(aggID, pid)
        }
        procID = nil
        if aggID != kAudioObjectUnknown { AudioHardwareDestroyAggregateDevice(aggID); aggID = AudioObjectID(kAudioObjectUnknown) }
        if tapID != kAudioObjectUnknown { AudioHardwareDestroyProcessTap(tapID); tapID = AudioObjectID(kAudioObjectUnknown) }
    }
}

signal(SIGTERM){ _ in exit(0) }
signal(SIGINT){ _ in exit(0) }

var excluded = findExcluded()
let tap = Tap()
guard tap.start(excluding: excluded) else {
    err("FATAL: タップを開始できません (システムオーディオ録音の権限を確認)")
    exit(1)
}
err("tap started rate=\(tap.rate) ch=\(tap.channels) excluded=\(excluded)")

// ヘッダ行 → 以降バイナリ
print("{\"rate\":\(Int(tap.rate)),\"ch\":\(tap.channels)}")
fflush(stdout)

// 除外対象の起動・再起動を監視してタップを組み直す
let timer = Timer(timeInterval: 3.0, repeats: true){ _ in
    let now = findExcluded()
    if now != excluded {
        err("exclude set changed \(excluded) -> \(now), rebuilding tap")
        excluded = now
        tap.stop()
        if !tap.start(excluding: excluded) {
            err("FATAL: タップ再構築に失敗")
            exit(1)
        }
    }
}
RunLoop.main.add(timer, forMode: .common)
RunLoop.main.run()
