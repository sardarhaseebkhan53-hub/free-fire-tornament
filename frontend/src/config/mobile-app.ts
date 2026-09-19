export const mobileAppConfig = {
  name: 'ClutchNex',
  mainWebsite: 'https://www.clutchnex.com/',
  downloadPage: process.env.NEXT_PUBLIC_DOWNLOAD_URL || 'https://www.clutchnex.com/app-download',
  androidUrl: process.env.NEXT_PUBLIC_ANDROID_APK_URL || '',
  iosUrl: process.env.NEXT_PUBLIC_IOS_APP_STORE_URL || '',
  instagramUrl: process.env.NEXT_PUBLIC_INSTAGRAM_URL || '',
  whatsappUrl: process.env.NEXT_PUBLIC_WHATSAPP_URL || '',
  tiktokUrl: process.env.NEXT_PUBLIC_TIKTOK_URL || '',
  appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '',
};

export const isConfigured = (url: string) => url.startsWith('https://');
