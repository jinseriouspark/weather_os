import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT) || 8787,
  kmaKey: process.env.KMA_SERVICE_KEY || '',
  metarKey: process.env.KMA_METAR_KEY || '',
  metarUrl: process.env.KMA_METAR_URL || '',
  googleKey: process.env.GOOGLE_WEATHER_KEY || '',
  apple: {
    teamId: process.env.APPLE_TEAM_ID || '',
    keyId: process.env.APPLE_KEY_ID || '',
    serviceId: process.env.APPLE_SERVICE_ID || '',
    privateKey: process.env.APPLE_PRIVATE_KEY || '',
  },
  naverEnabled: process.env.NAVER_CRAWL_ENABLED !== '0',
};

// 각 출처가 자격증명을 갖췄는지 (Open-Meteo는 항상 가능)
export function sourceAvailability() {
  return {
    openmeteo: true,
    kma: !!config.kmaKey,
    kma_metar: !!config.metarKey,
    google: !!config.googleKey,
    apple: !!(config.apple.teamId && config.apple.keyId && config.apple.serviceId && config.apple.privateKey),
    naver: config.naverEnabled,
  };
}
