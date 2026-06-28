module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      // MUST be the LAST plugin. Reanimated 4.x's worklets compiler needs this.
      // Note: 'react-native-worklets/plugin' is the 4.x-era path. (Reanimated 3.x
      // used 'react-native-reanimated/plugin'. We installed reanimated 4.1.7 +
      // react-native-worklets 0.5.1 — the latter was a missing peer dep that
      // `npx expo install react-native-reanimated` did NOT auto-add. Caught it
      // by checking the reanimated package's peerDependencies.)
      'react-native-worklets/plugin',
    ],
  };
};
