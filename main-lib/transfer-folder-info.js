'use strict';
const fs = require('node:fs');
const path = require('node:path');
function clean(value) {
 return Array.from(String(value || '').normalize('NFC').replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 48).join('');
}
function folderLabel(query) { return `SayPhoto ${clean(query) || '已选照片'} ${new Date().toISOString().slice(0,10)}`; }
function guide(query) {
 return `文件说明\n\n搜索关键词：${clean(query) || '未填写（手动选择）'}\n\n照片：JPG、JPEG、PNG、HEIC 等，双击查看。\n视频：MOV、MP4 等，双击播放。\n原始照片：RAW、DNG、CR2、NEF、ARW 等，适合用修图软件打开。\n实况照片（Live Photo）：通常由一张照片和一段短视频组成，请一起保留。\n配套文件：AAE、XMP 等，可能保存编辑信息，请和照片一起保留。\n其他格式：请使用支持该格式的软件打开。\n\n本文件夹只包含本次成功保存的文件，不一定含有上面所有类型。\n是否全部完成，请查看 SayPhoto 的任务结果。失败或跳过的项目不能算作已移动成功。\n使用网盘文件夹时，是否上传完成请查看网盘软件。\n`;
}
async function createFolder(destination, query) {
 const localPath = await fs.promises.mkdtemp(path.join(destination, folderLabel(query) + '-'));
 await fs.promises.writeFile(path.join(localPath, 'SayPhoto 文件说明.txt'), guide(query), {encoding:'utf8',flag:'wx'});
 return {localPath};
}
module.exports = {clean, folderLabel, guide, createFolder};
