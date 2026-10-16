// Share concurrent metadata reads between the gallery and search hook. No disk
// cache: invalidation detaches old requests so a later read sees the new library.
let pending: Promise<Record<string, unknown>> | null = null;
export function invalidateLibraryIndex() { pending = null; }
export function readLibraryIndex(): Promise<Record<string, unknown>> {
	if (pending) return pending;
	const request = (async () => {
		for (let attempt = 0; ; attempt++) {
			const response = await fetch("/memories-index.json", { cache: "no-store" });
			if (response.status !== 503 || attempt >= 2) return response;
			await new Promise(resolve => setTimeout(resolve, 1000));
		}
	})().then(response => {
		if (!response.ok) throw new Error("无法读取素材库");
		return response.json() as Promise<Record<string, unknown>>;
	});
	pending = request;
	void request.finally(() => { if (pending === request) pending = null; }).catch(() => {});
	return request;
}
