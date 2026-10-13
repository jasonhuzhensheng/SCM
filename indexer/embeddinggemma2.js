"use strict";
const path = require("node:path");
const { createRequire } = require("node:module");
const { pathToFileURL } = require("node:url");

// A separate runtime keeps the existing CLIP/SigLIP dependencies unchanged.
async function loadEmbeddingGemma2({ repo, cacheDir, progress_callback }) {
	const root = process.resourcesPath
		? path.join(process.resourcesPath, "embeddinggemma2")
		: path.join(__dirname, "../runtime/embeddinggemma2");
	const runtime = createRequire(path.join(root, "package.json"));
	const mod = await import(pathToFileURL(runtime.resolve("@huggingface/transformers")).href);
	if (cacheDir) mod.env.cacheDir = cacheDir;
	const config = await mod.AutoConfig.from_pretrained(repo);
	config.audio_config = null;
	const processor = await mod.AutoProcessor.from_pretrained(repo);
	const model = await mod.AutoModel.from_pretrained(repo, {
		config, device: "cpu", dtype: "q4", progress_callback,
	});
	const embed = async (...args) => {
		const result = (await model(await processor(...args))).sentence_embedding;
		if (result.data.length !== 768 || !Array.from(result.data).every(Number.isFinite)) {
			throw new Error("EmbeddingGemma 2 returned an invalid vector");
		}
		return result;
	};
	return {
		RawImage: mod.RawImage,
		sharp: runtime("sharp"),
		extractor: image => embed(null, image),
		tokenizer: text => ({ text }),
		textModel: async ({ text }) => ({ sentence_embedding: await embed(`title: none | text: ${text}`) }),
		queryModel: async ({ text }) => ({ sentence_embedding: await embed(`task: search result | query: ${text}`) }),
		textMean: null,
		dim: 768,
		outputKey: "sentence_embedding",
	};
}
module.exports = { loadEmbeddingGemma2 };
