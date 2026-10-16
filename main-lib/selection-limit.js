'use strict';
const MAX_FILE_SELECTION = 10000;
const FILE_SELECTION_LIMIT_MESSAGE = '每次最多选择 10,000 项素材，请减少选择后重试。';
function assertSelectionLimit(count) {
 if (count > MAX_FILE_SELECTION) { const error = Error(FILE_SELECTION_LIMIT_MESSAGE); error.retryable = false; throw error; }
}
module.exports = {MAX_FILE_SELECTION, FILE_SELECTION_LIMIT_MESSAGE, assertSelectionLimit};
