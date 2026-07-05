const fs = require('fs');
const path = require('path');

// Google AdSense Publisher ID (User can customize or replace)
const ADSENSE_PUB_ID = 'ca-pub-3834095799856701';

const articles = {
  'ga-basics.html': {
    title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説',
    desc: '生物進化のメカニズムを計算機に応用した遺伝的アルゴリズム（GA）について、初期世代の生成から選択、交叉、突然変異までの基本プロセスをわかりやすく解説します。',
    keywords: '遺伝的アルゴリズム, GA, 選択淘汰, 交叉, 突然変異, AI進化',
    category: 'アルゴリズム超入門',
    recommendations: [
      { url: 'crossover.html', title: '進化の核となる「交叉（Crossover）」の仕組み' },
      { url: 'mutation.html', title: 'なぜ突然変異（Mutation）が必要なのか？進化の多様性' },
      { url: 'history-of-ga.html', title: '遺伝的アルゴリズムの歴史：ダーウィンの進化論から計算機科学へ' }
    ]
  },
  'crossover.html': {
    title: '進化の核となる「交叉（Crossover）」の仕組み',
    desc: '遺伝的アルゴリズムにおいて、親の優秀なDNA情報を掛け合わせて新たな子孫を作る「交叉（Crossover）」のメカニズムを、一点交叉や一様交叉などの種類と併せて徹底解説。',
    keywords: '交叉, Crossover, 一点交叉, 一様交叉, 遺伝子シャッフル, 進化アルゴリズム',
    category: 'アルゴリズム詳細',
    recommendations: [
      { url: 'ga-basics.html', title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説' },
      { url: 'mutation.html', title: 'なぜ突然変異（Mutation）が必要なのか？進化の多様性' },
      { url: 'local-optima.html', title: '進化の落とし穴「局所最適解」とその脱出方法' }
    ]
  },
  'mutation.html': {
    title: 'なぜ突然変異（Mutation）が必要なのか？進化の多様性',
    desc: '遺伝的アルゴリズム（GA）における突然変異（Mutation）の決定的な役割。遺伝的多様性を維持し、局所解（行き詰まり）から脱出するための突然変異率の重要性を解説します。',
    keywords: '突然変異, Mutation, 突然変異率, 多様性, 局所解, 早期収束',
    category: 'アルゴリズム詳細',
    recommendations: [
      { url: 'ga-basics.html', title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説' },
      { url: 'crossover.html', title: '進化の核となる「交叉（Crossover）」の仕組み' },
      { url: 'local-optima.html', title: '進化の落とし穴「局所最適解」とその脱出方法' }
    ]
  },
  'line-vs-mosaic.html': {
    title: '線画（Line）とモザイク（Mosaic）のDNAパラメータの違い',
    desc: 'gene46に搭載されている2つのジェネレーティブアートモデル、線描画（Line Art）とモザイク（Mosaic Art）におけるDNAパラメータの構造や数式による表現方法の違いを技術解説。',
    keywords: '線画DNA, モザイクDNA, ジェネレーティブアート, パラメータ空間, 数値配列',
    category: 'システム・技術仕様',
    recommendations: [
      { url: 'generative-art.html', title: 'AIジェネレーティブアートと生物学的進化の融合' },
      { url: 'breeding-tips.html', title: 'gene46攻略ガイド：美しい個体を育てるコツ' },
      { url: 'ga-basics.html', title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説' }
    ]
  },
  'local-optima.html': {
    title: '進化の落とし穴「局所最適解」とその脱出方法',
    desc: '進化シミュレーションで発生する行き詰まり「局所最適解（ローカルオプティマ）」の原因。突然変異の調整や、スレッドフォーク機能がもたらす進化ブランチの強みを解説。',
    keywords: '局所最適解, 早期収束, ローカルオプティマ, スレッドフォーク, 進化の停滞',
    category: 'アルゴリズム詳細',
    recommendations: [
      { url: 'mutation.html', title: 'なぜ突然変異（Mutation）が必要なのか？進化の多様性' },
      { url: 'real-world-ga.html', title: '現実世界のエンジニアリングで活躍する遺伝的アルゴリズム' },
      { url: 'breeding-tips.html', title: 'gene46攻略ガイド：美しい個体を育てるコツ' }
    ]
  },
  'real-world-ga.html': {
    title: '現実世界のエンジニアリングで活躍する遺伝的アルゴリズム',
    desc: '新幹線の先頭形状デザイン、NASAの宇宙船アンテナ、電車の運行ダイヤやスタッフシフト作成など、現実社会の難解な最適化問題を解決する遺伝的アルゴリズムの実用例を紹介。',
    keywords: '新幹線デザイン, 空力設計, アンテナ設計, NASA, ダイヤ最適化, スケジューリング',
    category: 'アルゴリズム応用',
    recommendations: [
      { url: 'ga-basics.html', title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説' },
      { url: 'local-optima.html', title: '進化の落とし穴「局所最適解」とその脱出方法' },
      { url: 'human-ai-collaboration.html', title: '人間とAI hedge design：選択淘汰が生み出す未来' }
    ]
  },
  'generative-art.html': {
    title: 'AIジェネレーティブアートと生物学的進化の融合',
    desc: '人間の感性を適応度スコアとする「インタラクティブ進化計算（IEC）」に基づくジェネレーティブアートの魅力。作者すら予想できない機能美と偶発的デザインの世界。',
    keywords: 'ジェネレーティブアート, インタラクティブ進化計算, IEC, クリエイティブコーディング',
    category: 'ジェネレーティブアート',
    recommendations: [
      { url: 'line-vs-mosaic.html', title: '線画（Line）とモザイク（Mosaic）のDNAパラメータの違い' },
      { url: 'human-ai-collaboration.html', title: '人間とAIの協調デザイン：選択淘汰が生み出す未来' },
      { url: 'breeding-tips.html', title: 'gene46攻略ガイド：美しい個体を育てるコツ' }
    ]
  },
  'breeding-tips.html': {
    title: 'gene46攻略ガイド：美しい個体を育てるコツ',
    desc: 'スワイプ進化ゲーム「gene46」の完全攻略ガイド。初期世代の選択基準、進化方向の一貫性、フォーク（1000ソウル消費）やスタミナ上限解放を活かした美しい個体の育て方。',
    keywords: 'gene46攻略, 美しい個体, 選択基準, フォーク機能, スタミナ上限解放',
    category: 'gene46攻略',
    recommendations: [
      { url: 'local-optima.html', title: '進化の落とし穴「局所最適解」とその脱出方法' },
      { url: 'generative-art.html', title: 'AIジェネレーティブアートと生物学的進化の融合' },
      { url: 'line-vs-mosaic.html', title: '線画（Line）とモザイク（Mosaic）のDNAパラメータの違い' }
    ]
  },
  'human-ai-collaboration.html': {
    title: '人間とAIの協調デザイン：選択淘汰が生み出す未来',
    desc: 'AIに呪文で指示を出すプロンプトエンジニアリングから、AIの選択肢を人間が選別し共進化する「協調デザイン（Co-design）」へ。ジェネレーティブデザインの可能性を語る。',
    keywords: '協調デザイン, Co-design, 創造性, ジェネレーティブデザイン, プロンプトエンジニアリング',
    category: 'コラム・未来予測',
    recommendations: [
      { url: 'generative-art.html', title: 'AIジェネレーティブアートと生物学的進化の融合' },
      { url: 'real-world-ga.html', title: '現実世界のエンジニアリングで活躍する遺伝的アルゴリズム' },
      { url: 'history-of-ga.html', title: '遺伝的アルゴリズムの歴史：ダーウィンの進化論から計算機科学へ' }
    ]
  },
  'history-of-ga.html': {
    title: '遺伝的アルゴリズムの歴史：ダーウィンの進化論から計算機科学へ',
    desc: 'ダーウィンの「種の起源」から、アラン・チューリングの進化機械構想、精度高い数値を誇るジョン・ホランドのGA定式化に至るまでの歴史を解説。',
    keywords: 'GA歴史, 種の起源, ダーウィン, アラン・チューリング, ジョン・ホランド, スキーマ定理',
    category: 'アルゴリズム歴史',
    recommendations: [
      { url: 'ga-basics.html', title: '遺伝的アルゴリズム（GA）とは？仕組みと基本プロセスを徹底解説' },
      { url: 'human-ai-collaboration.html', title: '人間とAIの協調デザイン：選択淘汰が生み出す未来' },
      { url: 'real-world-ga.html', title: '現実世界のエンジニアリングで活躍する遺伝的アルゴリズム' }
    ]
  }
};

const blogDir = path.join(__dirname, '../public/blog');

// Enrich articles
Object.keys(articles).forEach(filename => {
  const filepath = path.join(blogDir, filename);
  if (!fs.existsSync(filepath)) {
    console.log(`File not found: ${filepath}`);
    return;
  }

  let content = fs.readFileSync(filepath, 'utf8');
  const metadata = articles[filename];

  // Prevent duplicate insertion of head snippets if script already runs
  if (!content.includes('adsbygoogle.js')) {
    const headSnippet = `
    <meta name="description" content="${metadata.desc}">
    <meta name="keywords" content="${metadata.keywords}">
    <link rel="canonical" href="https://gene46.net/blog/${filename}">
    <!-- Google AdSense Auto Ads -->
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUB_ID}" crossorigin="anonymous"></script>
    `;
    content = content.replace('</head>', `${headSnippet}\n</head>`);
  }

  // Prevent duplicate breadcrumbs
  if (!content.includes('class="breadcrumbs"')) {
    const breadcrumbSnippet = `
      <div class="breadcrumbs" style="font-size: 0.8rem; color: #64748b; margin-top: 10px; margin-bottom: 20px;">
        <a href="/" style="color: #64748b; text-decoration: none;">ホーム</a> &gt; 
        <a href="/blog/index.html" style="color: #64748b; text-decoration: none;">公式ブログ</a> &gt; 
        <span style="color: #cbd5e1;">${metadata.title}</span>
      </div>
    `;
    content = content.replace('<div class="container">', `<div class="container">\n${breadcrumbSnippet}`);
  }

  // Prevent duplicate E-E-A-T and recommended articles
  if (!content.includes('この記事の執筆・監修')) {
    const articleBottomSnippet = `
        <!-- Author Profile E-E-A-T -->
        <div class="card" style="background: rgba(168, 85, 247, 0.01); border: 1px solid rgba(168, 85, 247, 0.08); font-size: 0.85rem; margin-top: 40px; border-radius: 12px; padding: 20px;">
          <h4 style="margin-top: 0; color: #c084fc; font-weight: bold; font-size: 0.95rem; margin-bottom: 8px;">この記事の執筆・監修</h4>
          <p style="margin-bottom: 0; color: #94a3b8; line-height: 1.6;">
            <strong>gene46 運営・開発チーム (GA研究ユニット)</strong><br>
            遺伝的アルゴリズム（GA）を用いた自律進化型ジェネレーティブアートの挙動および最適化について研究・開発を行っているプロジェクトチームです。ゲーム開発と計算機科学の境界線上で活動しています。
          </p>
        </div>

        <!-- Recommended Articles -->
        <div style="margin-top: 40px;">
          <h3 style="font-size: 1.15rem; border-bottom: 1px solid rgba(168, 85, 247, 0.1); padding-bottom: 8px; color: #f1f5f9; font-weight: bold;">おすすめの関連記事</h3>
          <ul style="list-style: none; padding-left: 0; font-size: 0.9rem; line-height: 2.0; margin-top: 15px;">
            ${metadata.recommendations.map(r => `
              <li style="margin-bottom: 8px;">
                <span style="color: #a855f7; margin-right: 6px;">👉</span>
                <a href="/blog/${r.url}" style="color: #c084fc; text-decoration: none; font-weight: 600;">${r.title}</a>
              </li>
            `).join('')}
          </ul>
        </div>
    `;

    content = content.replace('</article>', `${articleBottomSnippet}\n</article>`);
  }

  fs.writeFileSync(filepath, content, 'utf8');
});

// Enrich main root files and static documents with the AdSense Tag
const globalFiles = [
  path.join(__dirname, '../index.html'),
  path.join(__dirname, '../public/about.html'),
  path.join(__dirname, '../public/privacy.html'),
  path.join(__dirname, '../public/terms.html'),
  path.join(__dirname, '../public/legal.html'),
  path.join(__dirname, '../public/contact.html'),
  path.join(__dirname, '../public/blog/index.html')
];

globalFiles.forEach(filepath => {
  if (!fs.existsSync(filepath)) {
    console.log(`Global file not found: ${filepath}`);
    return;
  }
  let content = fs.readFileSync(filepath, 'utf8');
  if (!content.includes('adsbygoogle.js')) {
    const adsenseTag = `\n  <!-- Google AdSense Auto Ads -->\n  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUB_ID}" crossorigin="anonymous"></script>`;
    content = content.replace('</head>', `${adsenseTag}\n</head>`);
    fs.writeFileSync(filepath, content, 'utf8');
    console.log(`Injected AdSense tag into: ${path.basename(filepath)}`);
  } else {
    console.log(`AdSense tag already exists in: ${path.basename(filepath)}`);
  }
});

console.log('All enrichment operations completed successfully!');
