import { useEffect, useRef, useState } from "react";
import { IconVideo } from "@tabler/icons-react";
import { formatTimecode } from "@/lib/media";

const durations = new Map<string, number>();

/** Probe only visible cards; release the media resource after reading metadata. */
export function VideoDuration({ src }: { src: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [duration, setDuration] = useState(durations.get(src));
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setDuration(durations.get(src));
		setFailed(false);
		if (durations.has(src)) return;
		let video: HTMLVideoElement | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const release = () => {
			clearTimeout(timer);
			if (!video) return;
			video.onloadedmetadata = null;
			video.onerror = null;
			video.removeAttribute("src");
			video.load();
		};
		const observer = new IntersectionObserver(entries => {
			if (!entries.some(entry => entry.isIntersecting)) return;
			observer.disconnect();
			video = document.createElement("video");
			video.preload = "metadata";
			video.onloadedmetadata = () => {
				const seconds = video!.duration;
				if (Number.isFinite(seconds) && seconds >= 0) {
					durations.set(src, seconds);
					setDuration(seconds);
				} else setFailed(true);
				release();
			};
			video.onerror = () => { setFailed(true); release(); };
			timer = setTimeout(() => { setFailed(true); release(); }, 15000);
			video.src = src;
		});
		if (ref.current) observer.observe(ref.current);
		return () => { observer.disconnect(); release(); };
	}, [src]);
	const label = duration !== undefined ? formatTimecode(duration) : failed ? "时长未知" : "读取时长…";
	return <span ref={ref} className="video-label" title={`视频总时长：${label}`}><IconVideo size={13} />{label}</span>;
}
