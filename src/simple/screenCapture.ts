// Conservative recording signals; camera videos and generic date names are not enough.
export function isScreenRecording(filename: string, sourcePath = ""): boolean {
 const parts = sourcePath.replace(/\\/g, "/").toLowerCase().split("/");
 const names = [filename, parts[parts.length-1] || ""].map(name => name.toLowerCase());
 const recording = /screen[\s_.-]*(?:record(?:ing|er)?|rec)(?:[\s_.-]|\d|$)|screenrecording|screenrecorder|rpreplay[_ -]?final|屏幕录制|螢幕錄製|萤幕录制|录屏|錄屏|画面収録|화면[ _-]?녹화/;
 if (names.some(name => recording.test(name))) return true;
 const folders = new Set(["screen recordings","screenrecordings","screen recording","screenrecorder","screen recordings","录屏","錄屏","屏幕录制","螢幕錄製","手机录屏","电脑录屏"]);
 if(parts.slice(0,-1).some(part => folders.has(part))) return true;
 // Windows Game Bar's dedicated Videos/Captures folder, not arbitrary "capture" files.
 return parts.some((part,index) => ["videos","视频","影片"].includes(part) && ["captures","捕获","擷取"].includes(parts[index+1] || ""));
}
