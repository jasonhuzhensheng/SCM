'use strict';
// A Photos package is not an ordinary media folder. Read originals only;
// derivatives/cloud caches are implementation details, never new assets.
function isPhotosInternal(file) {
 const match = String(file).replace(/\\/g,'/').match(/\.photoslibrary\/(.*)/i);
 return !!match && match[1] !== 'originals' && !match[1].startsWith('originals/');
}
module.exports = { isPhotosInternal };
