const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.alias = {
  '@': './src',
  '@/hooks': './src/hooks',
  '@/components': './src/components',
  '@/services': './src/services',
  '@/models': './src/models',
  '@nozbe/watermelondb/adapters/sqlite': './src/adapters/sqlite-web.ts',
};

module.exports = config;