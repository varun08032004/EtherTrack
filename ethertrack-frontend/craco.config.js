// craco.config.js
const path = require('path');
const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin;
const TerserPlugin = require('terser-webpack-plugin');
const CompressionPlugin = require('compression-webpack-plugin');

module.exports = {
  style: {
    postcss: {
      mode: 'file',
    },
  },
  webpack: {
    configure: (webpackConfig, { env }) => {
      if (env === 'production') {
        // Code splitting
        webpackConfig.optimization = {
          ...webpackConfig.optimization,
          splitChunks: {
            chunks: 'all',
            minSize: 20000,
            maxSize: 244000,
            minChunks: 1,
            maxAsyncRequests: 30,
            maxInitialRequests: 30,
            automaticNameDelimiter: '~',
            enforceSizeThreshold: 50000,
            cacheGroups: {
              default: false,
              vendors: {
                test: /[\\/]node_modules[\\/]/,
                name: 'vendors',
                chunks: 'all',
                priority: -10,
                reuseExistingChunk: true,
              },
              common: {
                name: 'common',
                minChunks: 2,
                chunks: 'all',
                priority: -20,
                reuseExistingChunk: true,
              },
              react: {
                test: /[\\/]node_modules[\\/](react|react-dom|react-router)[\\/]/,
                name: 'react',
                chunks: 'all',
                priority: 20,
              },
              ethers: {
                test: /[\\/]node_modules[\\/]ethers[\\/]/,
                name: 'ethers',
                chunks: 'all',
                priority: 15,
              },
              chart: {
                test: /[\\/]node_modules[\\/](recharts|d3)[\\/]/,
                name: 'chart',
                chunks: 'all',
                priority: 10,
              },
              pdf: {
                test: /[\\/]node_modules[\\/](pdfkit|pdfjs)[\\/]/,
                name: 'pdf',
                chunks: 'all',
                priority: 10,
              },
            },
          },

          // Terser optimization
          minimize: true,
          minimizer: [
            new TerserPlugin({
              terserOptions: {
                parse: { ecma: 2020 },
                compress: {
                  ecma: 2020,
                  comparisons: false,
                  inline: 2,
                  drop_console: true,
                  drop_debugger: true,
                  pure_funcs: ['console.log', 'console.info', 'console.debug'],
                },
                mangle: { safari10: true },
                output: {
                  ecma: 2020,
                  comments: false,
                  ascii_only: true,
                },
              },
              extractComments: false,
            }),
          ],
        };
      }

      // Add plugins
      webpackConfig.plugins = [
        ...webpackConfig.plugins,
        new CompressionPlugin({
          algorithm: 'gzip',
          test: /\.(js|css|html|svg)$/,
          threshold: 10240,
          minRatio: 0.8,
        }),
      ];

      // Enable scope hoisting
      webpackConfig.optimization.concatenateModules = true;

      // Configure devServer directly in webpack config to avoid craco merging issues
      if (process.env.NODE_ENV !== 'production') {
        webpackConfig.devServer = {
          host: '0.0.0.0',
          port: 3000,
          historyApiFallback: true,
          proxy: [
            {
              context: ['/api'],
              target: 'http://localhost:5000',
              changeOrigin: true,
            },
          ],
          setupMiddlewares: (middlewares) => middlewares,
        };
      }

      return webpackConfig;
    },
  },
  plugins: [
    // Enable bundle analyzer in development
    ...(process.env.ANALYZE ? [new BundleAnalyzerPlugin()] : []),
  ],
};