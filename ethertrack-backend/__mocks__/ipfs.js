// __mocks__/ipfs.js
module.exports = {
  uploadJSON: jest.fn().mockResolvedValue({ IpfsHash: 'QmTest123' }),
  uploadFile: jest.fn().mockResolvedValue({ IpfsHash: 'QmTest123' }),
};