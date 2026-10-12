import type { Asset } from "./library";

const specs = [
	["山谷里的清晨.jpg", "10", "旅行记录", "山 森林 河流 自然 风景 清晨"],
	["沿着海岸线.jpg", "16", "旅行记录", "海边 海岸 沙滩 蓝色 旅行"],
	["森林深处.jpg", "28", "旅行记录", "森林 绿树 自然 阳光"],
	["雪山之间.jpg", "29", "旅行记录", "雪山 山脉 自然 风景"],
	["城市漫步.jpg", "43", "日常灵感", "城市 建筑 街道 旅行"],
	["周末的咖啡.jpg", "63", "日常灵感", "咖啡 日常 桌面 静物"],
	["远方的风景.jpg", "54", "旅行记录", "山 自然 远方 风景"],
	["阳光落下的地方.jpg", "49", "日常灵感", "阳光 海边 自然 风景"],
	["安静的午后.jpg", "42", "日常灵感", "咖啡 午后 日常"],
];
export const demoAssets: Asset[] = specs.map(([title, id, folder, tags], i) => ({
	filename: `demo-${id}.jpg`, title, sourcePath: `/示例素材/${folder}/${title}`,
	category: "Projects", score: 0, ocr: "", modifiedAt: Date.UTC(2026, 9, 11 - i, 18),
	previewUrl: `/demo/${id}.jpg`, mediaUrl: `/demo/${id}.jpg`, tags,
}));

// Browser previews are explicitly separate from the desktop library. No bridge
// is fabricated, and no sample entries are ever written to the real index.
export function preparePreview() {
	const original = window.fetch.bind(window);
	window.fetch = (input, init) => {
		const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const path = new URL(raw, location.href).pathname;
		if (path === "/memories-index.json") return Promise.resolve(Response.json({ images: [], dim: 0 }));
		if (path === "/memories-models.json") return Promise.resolve(Response.json({ models: [], activeModelId: null }));
		if (/^\/memory-.*\.(bin|json)$/.test(path)) return Promise.resolve(new Response(null, { status: 404 }));
		return original(input, init);
	};
}
