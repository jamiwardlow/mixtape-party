const { withInfoPlist, withEntitlementsPlist } = require('expo/config-plugins');

const USAGE_DESCRIPTION =
  'Mixtape Party uses your Apple Music library to find and submit tracks for your rounds.';

// @lomray/react-native-apple-music ships no config plugin yet
// (https://github.com/Lomray-Software/react-native-apple-music/pull/16 open, unmerged),
// so Info.plist / entitlements are wired by hand here.
function withAppleMusicKit(config) {
  config = withInfoPlist(config, (config) => {
    config.modResults.NSAppleMusicUsageDescription = USAGE_DESCRIPTION;
    return config;
  });

  config = withEntitlementsPlist(config, (config) => {
    config.modResults['com.apple.developer.musickit'] = true;
    return config;
  });

  return config;
}

module.exports = withAppleMusicKit;
