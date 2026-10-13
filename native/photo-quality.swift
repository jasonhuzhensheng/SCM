import Foundation
import Vision
import ImageIO

struct Score: Codable {
	let score: Float?
	let error: String?
}

@main struct PhotoQuality {
	static func main() async {
		guard #available(macOS 15.0, *) else {
			print("{\"error\":\"AI 优选需要 macOS 15 或更新版本\"}")
			return
		}
		var results: [Score] = []
		for file in CommandLine.arguments.dropFirst() {
			do {
				guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: file) as CFURL, nil),
					let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
						kCGImageSourceCreateThumbnailFromImageAlways: true,
						kCGImageSourceCreateThumbnailWithTransform: true,
						kCGImageSourceThumbnailMaxPixelSize: 1600
					] as CFDictionary) else {
					results.append(Score(score: nil, error: "无法读取照片"))
					continue
				}
				let observation = try await CalculateImageAestheticsScoresRequest(.revision1).perform(on: image)
				results.append(Score(score: observation.overallScore, error: nil))
			} catch {
				results.append(Score(score: nil, error: "照片评分失败"))
			}
		}
		if let data = try? JSONEncoder().encode(results), let json = String(data: data, encoding: .utf8) { print(json) }
	}
}
