if (!process.env.CI && process.env.HUSKY !== '0') {
  console.log('Run pnpm exec husky to enable repository hooks.');
}
