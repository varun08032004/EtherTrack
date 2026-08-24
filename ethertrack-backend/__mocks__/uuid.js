// __mocks__/uuid.js
const v4 = () => '00000000-0000-4000-8000-000000000000';
const v5 = () => '00000000-0000-5000-8000-000000000000';

module.exports = { v4, v5 };
module.exports.v4 = v4;
module.exports.v5 = v5;
module.exports.default = { v4, v5 };