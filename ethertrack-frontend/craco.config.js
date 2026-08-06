// craco.config.js
module.exports = {
  style: {
    postcss: {
      mode: 'file',
    },
  },
  devServer: {
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
};