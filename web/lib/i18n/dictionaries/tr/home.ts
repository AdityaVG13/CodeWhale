import type { HomeDict } from "../types";

/** Turkish home copy: useful work with chosen models and connected tools. */

export const home: HomeDict = {
  metaTitle: "Codewhale: açık kaynak kodlama ajanı",
  metaDescription: "Codewhale, terminaliniz için açık kaynak bir kodlama ajanıdır. Kendi barındırılan veya yerel modellerinizle projeleri okuyun, düzenleyin ve test edin.",
  heroTitle: "Uygulamalar geliştir ve işlerini otomatikleştir.",
  heroIntro: "{brand}, terminalde dosyaları okuyan, kod yazan ve komutları çalıştıran açık kaynak bir kodlama ajanıdır. Model API’nizi veya yerel modelinizi bağlayın ve hangi işlemlerin onay gerektirdiğini seçin.",
  getCodewhale: "Codewhale'i kur",
  heroInstallAria: "Kurulum komutu",
  exploreProduct: "Codewhale’i keşfet",
  shotPreview: "Terminal önizlemesi",
  screenshotAlt:
    "Codewhale v{version}: sohbeti, mesaj alanını ve oturum kontrollerini gösteren terminal kaydı.",
  latestRelease: "En yeni sürüm {tag}",
  releaseUnavailable: "Sürüm durumu kullanılamıyor",
  currentSource: "Kaynak",
  sourceCandidate: "Yayımlanmadı",
  publishedRelease: "yayımlandı",
  gainHeading:
    "Neler yapabilirsin",
  gainLede:
    "Ne geliştirmek veya otomatikleştirmek istediğini anlat. Codewhale, erişimini senin belirlediğin sınırlar içinde dosyaları düzenleyebilir, komut çalıştırabilir ve sonucu kontrol edebilir.",
  gain: [
    [
      "Uygulamalar ve araçlar geliştir",
      "Bir uygulama geliştir, bir özellik ekle veya bir betik yaz. Codewhale proje dosyaları üzerinde çalışabilir, kodu çalıştırabilir ve geliştirdiği şeyi test edebilir."
    ],
    [
      "Tekrarlanan işleri otomatikleştir",
      "İş akışlarını terminalinden, betiklerden veya CI üzerinden çalıştır. Daha büyük görevlerde işin bölümlerini farklı modeller kullanan bir Fleet ajan ekibine devret."
    ],
    [
      "Kullandığın araçları bağla",
      "Eklentiler ve MCP sunucuları aracılığıyla araçlar ekle veya kendi betiklerinden API’leri kullan. Her hizmet kendi kurulumunu ve kimlik doğrulamasını gerektirir."
    ]
  ],
  chapterModels: "Senin modellerin",
  modelsHeading: "Seçtiğin modelleri kullan",
  modelsBody:
    "Sağlayıcı hesaplarını, OpenAI uyumlu bir uç noktayı veya yerel ve kendi barındırdığın modelleri bağla. Oturum ve Fleet içindeki her ajan için bir model seç.",
  modelsFacts: [
    [
      "API hesapların",
      "OpenAI, Anthropic, Google veya DeepSeek’i kendi anahtarlarınla bağla."
    ],
    [
      "Ağ geçidin",
      "OpenAI uyumlu bir uç nokta kullan ve sunduğu modelleri seç."
    ],
    [
      "Kendi çıkarımın",
      "Ollama, vLLM veya SGLang ile yerel ya da kendi barındırdığın modelleri çalıştır."
    ]
  ],
  modelsLink: "Modellere ve sağlayıcılara göz at",
  startHeading: "Başlarken",
  startLede:
    "Codewhale’i yükle, bir model bağla ve bir proje klasörü aç. İhtiyaç duydukça eklentiler ve daha fazla ajan ekleyebilirsin.",
  startGuideLink: "Başlangıç kılavuzunu takip et",
  startVocabularyLink: "Ürün sözlüğünü gör",
  chapterAvailability: "Nerede çalışır",
  availabilityHeading: "Şimdi kullanılabilenler ve geliştirilmekte olanlar",
  availabilityLede:
    "Terminal ve yerel tarayıcı istemcisi hazır. Yerel masaüstü uygulaması ve yeniden kurulan barındırılmış web uygulaması geliştiriliyor.",
  availability: [
    [
      "Terminal ve yerel tarayıcı",
      "Yayınlandı",
      "Linux, macOS veya Windows üzerine kur, ardından codewhale komutunu ya da yerel tarayıcı istemcisi için codewhale web komutunu çalıştır. npm ve Cargo da çalışır; Termux üzerinde Android önizleme aşamasında."
    ],
    [
      "CodeWhale GUI (VS Code)",
      "Kullanılabilir",
      "Topluluk tarafından sürdürülen ayrı bir proje: aynı Codewhale Runtime üzerinde VS Code kenar çubuğunda sohbet, konular ve dosya değişiklikleri. VS Code Marketplace'ten kur.",
      "https://marketplace.visualstudio.com/items?itemName=HengQuWorld.brotherwhale-vscode"
    ],
    [
      "Web uygulaması",
      "Geliştirme önizlemesi",
      "Masaüstü uygulamasına uyacak şekilde yeniden yapılıyor. Bugün oturum açabilir, ardından çalışan bir terminal oturumuna /rc yazarak o oturumu web üzerinde sürdürebilirsin; barındırılan görev yürütme hâlâ doğrulanıyor."
    ],
    [
      "Masaüstü",
      "Geliştirme sürümü",
      "Codewhale'in ana istemcisi haline gelen yerel uygulama: klasörler, sohbetler ve model bağlantıları tek bir pencerede. Henüz herkese açık indirme yok."
    ],
    [
      "Bulut bilgisayarları",
      "Geliştirme aşamasında",
      "Görevlerini çalıştıran barındırılan bilgisayarlar."
    ]
  ],
  availabilityNote:
    "Terminal, yerel tarayıcı ve GUI için Codewhale hesabı gerekmez. Barındırılan web ve masaüstü uygulaması bir hesap kullanır. Kendi sağlayıcı anahtarını kullanırsan, bu kullanımı sağlayıcın faturalandırır.",
  accountLink: "Hesap oluştur",
  surfacesHeading: "Dosyalar ve araçlarla çalış",
  surfaces: [
    [
      "Dosyalar ve terminal",
      "Dosya oluştur, komut çalıştır, verileri incele ve geliştirdiklerini test et. Çalışma klasörünü ve izinleri sen belirlersin."
    ],
    [
      "Eklentiler ve bağlı uygulamalar",
      "Eklentiler ve MCP ile beceriler ve araçlar ekle. Ajanın kullanmasını istediğin bağlantıları incele ve etkinleştir."
    ],
    [
      "Tarayıcı ve bilgisayar · önizleme",
      "Verdiğin erişim kapsamında uygulama ve sitelerde tarayıcı araçları ve Computer Use eklentisiyle çalış."
    ],
    [
      "Devam edebileceğin oturumlar",
      "Sohbeti, araç sonuçlarını ve çalışma geçmişini bir arada tut. Görevi terminalde veya yerel tarayıcı istemcisinde sürdür."
    ],
    [
      "Ajan ekipleri",
      "Büyük bir işi Fleet ile farklı rol ve modellerdeki ajanlara böl, ilerlemelerini tek yerde izle."
    ]
  ],
  runtimeLink: "Araçları ve entegrasyonları keşfet",
  installBandHeading: "macOS veya Linux üzerine kur",
  copy: "Kopyala",
  copied: "Kopyalandı ✓",
  binaries: "İkililer",
  chinaMirrors: "Çin yansıları",
  installGuideLink: "Kurulum kılavuzunu oku",
  communityHeading: "Codewhale’e katkıda bulun",
  communityBody:
    "GitHub’da bir hata bildir, belgeleri iyileştir veya kod katkısı yap. Ayrıca eklentiler geliştirebilir ve iş akışlarını diğer kullanıcılarla paylaşabilirsin.",
  communityLinksAria: "Topluluk bağlantıları",
  contribute: "GitHub’da katkıda bulun",
};
