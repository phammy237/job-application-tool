/**
 * Curated technology dictionary for myOS. Pure and deterministic.
 *
 * Matching rules (documented because they are an anti-hallucination boundary):
 *  - Matching is on whole tokens: an alias never matches inside a longer word ("Gopher" is not Go,
 *    "Reactive" is not React, "R&D" is not R).
 *  - Aliases are case-insensitive by default.
 *  - Ambiguous names that are also ordinary English words or single letters ("Go", "R", "C",
 *    "Express", "Swift", "Render", "Excel") are CASE-SENSITIVE and additionally need programming
 *    context nearby ("written in Go", "Go, Rust", "R language", "with Express") — "Go to the
 *    store" never matches. Unambiguous forms ("Golang", "C++", "C#") match freely.
 */

export type TechCategory =
  'LANGUAGE' | 'FRAMEWORK' | 'DATABASE' | 'CLOUD' | 'TOOL' | 'AI_ML' | 'PRACTICE';

export interface TechEntry {
  canonical: string;
  category: TechCategory;
  aliases: readonly string[];
  /** Broader skill areas this technology implies. */
  areas: readonly string[];
  /** Ambiguous names that need case-sensitivity + context. */
  strictAliases?: readonly string[];
}

const BE = 'Backend Development';
const FE = 'Frontend Development';
const DB = 'Databases';
const CLOUD = 'Cloud Infrastructure';
const DEVOPS = 'DevOps';
const ML = 'Machine Learning';
const GENAI = 'Generative AI';
const DATA = 'Data Engineering';
const ANALYSIS = 'Data Analysis';
const MOBILE = 'Mobile Development';
const TEST = 'Testing & Quality';
const SEC = 'Security';
const API = 'API Design';
const SWE = 'Software Engineering';
const PM = 'Product Management';

function t(
  canonical: string,
  category: TechCategory,
  areas: string[],
  aliases: string[] = [],
  strictAliases?: string[],
): TechEntry {
  return { canonical, category, aliases, areas, strictAliases };
}

export const TECH_DICTIONARY: readonly TechEntry[] = [
  // Languages
  t('Python', 'LANGUAGE', [SWE]),
  t('TypeScript', 'LANGUAGE', [SWE, FE]),
  t('JavaScript', 'LANGUAGE', [SWE, FE], ['js', 'ecmascript']),
  t('Java', 'LANGUAGE', [SWE, BE]),
  t('Kotlin', 'LANGUAGE', [SWE, MOBILE]),
  t('Swift', 'LANGUAGE', [SWE, MOBILE], [], ['Swift']),
  t('C++', 'LANGUAGE', [SWE], ['cpp']),
  t('C#', 'LANGUAGE', [SWE], ['csharp']),
  t('C', 'LANGUAGE', [SWE], [], ['C']),
  t('Go', 'LANGUAGE', [SWE, BE], ['golang'], ['Go']),
  t('Rust', 'LANGUAGE', [SWE]),
  t('R', 'LANGUAGE', [ANALYSIS], [], ['R']),
  t('Ruby', 'LANGUAGE', [SWE, BE]),
  t('PHP', 'LANGUAGE', [SWE, BE]),
  t('Scala', 'LANGUAGE', [SWE, DATA]),
  t('SQL', 'LANGUAGE', [DB, ANALYSIS]),
  t('Bash', 'LANGUAGE', [DEVOPS], ['shell scripting', 'shell script']),
  t('HTML', 'LANGUAGE', [FE], ['html5']),
  t('CSS', 'LANGUAGE', [FE], ['css3']),
  t('Dart', 'LANGUAGE', [SWE, MOBILE]),
  t('Lua', 'LANGUAGE', [SWE]),
  t('MATLAB', 'LANGUAGE', [ANALYSIS]),
  t('Solidity', 'LANGUAGE', [SWE]),
  t('Haskell', 'LANGUAGE', [SWE]),
  t('Elixir', 'LANGUAGE', [SWE, BE]),
  t('Objective-C', 'LANGUAGE', [SWE, MOBILE]),
  t('Julia', 'LANGUAGE', [ANALYSIS], [], ['Julia']),
  t('GraphQL', 'LANGUAGE', [API, BE]),
  t('HCL', 'LANGUAGE', [DEVOPS]),

  // Frontend / backend frameworks
  t('React', 'FRAMEWORK', [FE], ['react.js', 'reactjs']),
  t('Next.js', 'FRAMEWORK', [FE, BE], ['nextjs', 'next js']),
  t('Vue', 'FRAMEWORK', [FE], ['vue.js', 'vuejs']),
  t('Nuxt', 'FRAMEWORK', [FE], ['nuxt.js', 'nuxtjs']),
  t('Angular', 'FRAMEWORK', [FE], ['angularjs']),
  t('Svelte', 'FRAMEWORK', [FE], ['sveltekit']),
  t('Remix', 'FRAMEWORK', [FE], [], ['Remix']),
  t('Astro', 'FRAMEWORK', [FE], [], ['Astro']),
  t('Redux', 'FRAMEWORK', [FE]),
  t('Tailwind CSS', 'FRAMEWORK', [FE], ['tailwind', 'tailwindcss']),
  t('Bootstrap', 'FRAMEWORK', [FE]),
  t('Material UI', 'FRAMEWORK', [FE], ['mui']),
  t('shadcn/ui', 'FRAMEWORK', [FE], ['shadcn']),
  t('Vite', 'TOOL', [FE]),
  t('Webpack', 'TOOL', [FE]),
  t('Node.js', 'FRAMEWORK', [BE], ['nodejs', 'node js']),
  t('Express', 'FRAMEWORK', [BE], ['express.js', 'expressjs'], ['Express']),
  t('NestJS', 'FRAMEWORK', [BE], ['nest.js']),
  t('Fastify', 'FRAMEWORK', [BE]),
  t('FastAPI', 'FRAMEWORK', [BE, API], ['fast api']),
  t('Flask', 'FRAMEWORK', [BE]),
  t('Django', 'FRAMEWORK', [BE]),
  t('Spring Boot', 'FRAMEWORK', [BE], [], ['Spring']),
  t('Ruby on Rails', 'FRAMEWORK', [BE], [], ['Rails']),
  t('Laravel', 'FRAMEWORK', [BE]),
  t('ASP.NET', 'FRAMEWORK', [BE], ['asp.net core']),
  t('.NET', 'FRAMEWORK', [BE], ['dotnet']),
  t('Gin', 'FRAMEWORK', [BE], [], ['Gin']),
  t('tRPC', 'FRAMEWORK', [API, BE]),
  t('REST', 'PRACTICE', [API, BE], ['restful', 'rest api', 'rest apis']),
  t('gRPC', 'FRAMEWORK', [API, BE]),
  t('WebSockets', 'TOOL', [BE], ['websocket']),
  t('Apollo', 'FRAMEWORK', [API], ['apollo graphql']),
  t('Prisma', 'FRAMEWORK', [DB, BE]),
  t('SQLAlchemy', 'FRAMEWORK', [DB, BE]),
  t('Drizzle', 'FRAMEWORK', [DB, BE], ['drizzle orm']),
  t('Pydantic', 'FRAMEWORK', [BE]),
  t('Zod', 'FRAMEWORK', [SWE]),
  t('Celery', 'FRAMEWORK', [BE]),
  t('React Native', 'FRAMEWORK', [MOBILE, FE]),
  t('Flutter', 'FRAMEWORK', [MOBILE]),
  t('Expo', 'FRAMEWORK', [MOBILE], [], ['Expo']),
  t('SwiftUI', 'FRAMEWORK', [MOBILE]),
  t('Electron', 'FRAMEWORK', [FE, SWE], [], ['Electron']),

  // Databases
  t('PostgreSQL', 'DATABASE', [DB, BE], ['postgres', 'psql']),
  t('MySQL', 'DATABASE', [DB]),
  t('SQLite', 'DATABASE', [DB]),
  t('MongoDB', 'DATABASE', [DB], ['mongo']),
  t('Redis', 'DATABASE', [DB]),
  t('Supabase', 'DATABASE', [DB, BE]),
  t('Firebase', 'DATABASE', [BE, MOBILE]),
  t('DynamoDB', 'DATABASE', [DB, CLOUD]),
  t('Elasticsearch', 'DATABASE', [DB], ['opensearch']),
  t('Cassandra', 'DATABASE', [DB]),
  t('Neo4j', 'DATABASE', [DB]),
  t('Snowflake', 'DATABASE', [DATA, DB], [], ['Snowflake']),
  t('BigQuery', 'DATABASE', [DATA, CLOUD], ['big query']),
  t('pgvector', 'DATABASE', [DB, GENAI]),
  t('Pinecone', 'DATABASE', [DB, GENAI]),
  t('Chroma', 'DATABASE', [DB, GENAI], ['chromadb']),
  t('Weaviate', 'DATABASE', [DB, GENAI]),
  t('FAISS', 'DATABASE', [GENAI, ML]),

  // Cloud / infra
  t('AWS', 'CLOUD', [CLOUD], ['amazon web services']),
  t('Google Cloud', 'CLOUD', [CLOUD], ['gcp', 'google cloud platform']),
  t('Azure', 'CLOUD', [CLOUD], ['microsoft azure']),
  t('Vercel', 'CLOUD', [CLOUD]),
  t('Netlify', 'CLOUD', [CLOUD]),
  t('Cloudflare', 'CLOUD', [CLOUD], ['cloudflare workers']),
  t('Heroku', 'CLOUD', [CLOUD]),
  t('Fly.io', 'CLOUD', [CLOUD]),
  t('Railway', 'CLOUD', [CLOUD], [], ['Railway']),
  t('Render', 'CLOUD', [CLOUD], [], ['Render']),
  t('AWS Lambda', 'CLOUD', [CLOUD, BE], ['lambda functions']),
  t('Amazon S3', 'CLOUD', [CLOUD], ['aws s3']),
  t('EC2', 'CLOUD', [CLOUD], ['aws ec2']),
  t('Docker', 'TOOL', [DEVOPS], ['dockerfile', 'docker compose', 'docker-compose']),
  t('Kubernetes', 'TOOL', [DEVOPS, CLOUD], ['k8s']),
  t('Terraform', 'TOOL', [DEVOPS, CLOUD]),
  t('Ansible', 'TOOL', [DEVOPS]),
  t('Helm', 'TOOL', [DEVOPS], [], ['Helm']),
  t('GitHub Actions', 'TOOL', [DEVOPS], ['github workflows']),
  t('GitLab CI', 'TOOL', [DEVOPS], ['gitlab ci/cd']),
  t('Jenkins', 'TOOL', [DEVOPS]),
  t('CircleCI', 'TOOL', [DEVOPS]),
  t('CI/CD', 'PRACTICE', [DEVOPS], ['continuous integration', 'continuous deployment']),
  t('Nginx', 'TOOL', [DEVOPS, BE]),
  t('Linux', 'TOOL', [DEVOPS]),
  t('Prometheus', 'TOOL', [DEVOPS]),
  t('Grafana', 'TOOL', [DEVOPS]),
  t('Datadog', 'TOOL', [DEVOPS]),
  t('Sentry', 'TOOL', [DEVOPS], [], ['Sentry']),
  t('Kafka', 'TOOL', [DATA, BE], ['apache kafka']),
  t('RabbitMQ', 'TOOL', [BE]),

  // Data
  t('Apache Spark', 'TOOL', [DATA], ['pyspark'], ['Spark']),
  t('Airflow', 'TOOL', [DATA], ['apache airflow']),
  t('dbt', 'TOOL', [DATA, ANALYSIS]),
  t('Pandas', 'FRAMEWORK', [ANALYSIS]),
  t('NumPy', 'FRAMEWORK', [ANALYSIS]),
  t('Matplotlib', 'FRAMEWORK', [ANALYSIS]),
  t('Jupyter', 'TOOL', [ANALYSIS], ['jupyter notebook', 'jupyter notebooks']),
  t('Tableau', 'TOOL', [ANALYSIS]),
  t('Power BI', 'TOOL', [ANALYSIS], ['powerbi']),
  t('Looker', 'TOOL', [ANALYSIS]),
  t('Excel', 'TOOL', [ANALYSIS], ['microsoft excel'], ['Excel']),
  t('Google Analytics', 'TOOL', [ANALYSIS]),
  t('Amplitude', 'TOOL', [ANALYSIS], [], ['Amplitude']),
  t('Mixpanel', 'TOOL', [ANALYSIS]),
  t('ETL', 'PRACTICE', [DATA], ['etl pipelines', 'data pipelines', 'data pipeline']),

  // AI / ML
  t('PyTorch', 'AI_ML', [ML]),
  t('TensorFlow', 'AI_ML', [ML]),
  t('Keras', 'AI_ML', [ML]),
  t('scikit-learn', 'AI_ML', [ML], ['sklearn', 'scikit learn']),
  t('XGBoost', 'AI_ML', [ML]),
  t('Hugging Face', 'AI_ML', [ML, GENAI], ['huggingface']),
  t('OpenCV', 'AI_ML', [ML], ['computer vision']),
  t('spaCy', 'AI_ML', [ML], ['nlp', 'natural language processing']),
  t('Machine Learning', 'AI_ML', [ML], ['ml models']),
  t('Deep Learning', 'AI_ML', [ML], ['neural networks']),
  t('LangChain', 'AI_ML', [GENAI]),
  t('LlamaIndex', 'AI_ML', [GENAI]),
  t('OpenAI API', 'AI_ML', [GENAI], ['openai', 'gpt-4', 'chatgpt']),
  t('Anthropic Claude', 'AI_ML', [GENAI], ['anthropic', 'claude api']),
  t('Large Language Models', 'AI_ML', [GENAI], ['llm', 'llms']),
  t(
    'RAG',
    'AI_ML',
    [GENAI],
    ['retrieval augmented generation', 'retrieval-augmented generation'],
  ),
  t('Prompt Engineering', 'PRACTICE', [GENAI]),
  t('Embeddings', 'AI_ML', [GENAI], ['vector embeddings', 'vector search']),
  t('Vercel AI SDK', 'AI_ML', [GENAI]),
  t('Ollama', 'AI_ML', [GENAI]),

  // Tools
  t('Git', 'TOOL', [SWE]),
  t('GitHub', 'TOOL', [SWE]),
  t('Figma', 'TOOL', ['Design']),
  t('Jira', 'TOOL', [PM]),
  t('Notion', 'TOOL', [PM], [], ['Notion']),
  t('Postman', 'TOOL', [API]),
  t('OpenAPI', 'TOOL', [API], ['swagger']),
  t('Stripe', 'TOOL', [BE]),
  t('Twilio', 'TOOL', [BE]),
  t('OAuth', 'PRACTICE', [SEC, BE], ['oauth2', 'oauth 2.0']),
  t('JWT', 'PRACTICE', [SEC, BE], ['json web tokens', 'json web token']),
  t('Playwright', 'TOOL', [TEST]),
  t('Cypress', 'TOOL', [TEST]),
  t('Selenium', 'TOOL', [TEST]),
  t('Jest', 'TOOL', [TEST]),
  t('Vitest', 'TOOL', [TEST]),
  t('pytest', 'TOOL', [TEST]),
  t('Storybook', 'TOOL', [FE]),
  t('ESLint', 'TOOL', [SWE]),
  t('Turborepo', 'TOOL', [SWE]),
  t('Monorepo', 'PRACTICE', [SWE], ['monorepos', 'npm workspaces']),
  t(
    'Chrome Extension',
    'FRAMEWORK',
    [FE],
    ['chrome extensions', 'browser extension', 'manifest v3'],
  ),
  t('Web Scraping', 'PRACTICE', [DATA], ['web scraper', 'scrapy', 'beautifulsoup']),

  // Practices
  t('Agile', 'PRACTICE', [PM], ['scrum', 'kanban']),
  t('Test-Driven Development', 'PRACTICE', [TEST], ['tdd']),
  t('Microservices', 'PRACTICE', [BE]),
  t('Serverless', 'PRACTICE', [CLOUD]),
  t('Infrastructure as Code', 'PRACTICE', [DEVOPS], ['iac']),
  t('Row Level Security', 'PRACTICE', [SEC, DB], ['rls']),
  t('A/B Testing', 'PRACTICE', [ANALYSIS], ['ab testing', 'a/b tests']),
  t('Accessibility', 'PRACTICE', [FE], ['wcag', 'a11y']),
  t('User Research', 'PRACTICE', [PM], ['user interviews', 'usability testing']),
  t('Product Management', 'PRACTICE', [PM], ['product roadmap']),
];

const BY_CANONICAL = new Map<string, TechEntry>(
  TECH_DICTIONARY.map((e) => [e.canonical.toLowerCase(), e]),
);

/** Broader skill areas implied by a technology (empty when unknown). */
export function skillAreasFor(canonical: string): string[] {
  return [...(BY_CANONICAL.get(canonical.trim().toLowerCase())?.areas ?? [])];
}

export function techEntryFor(canonical: string): TechEntry | undefined {
  return BY_CANONICAL.get(canonical.trim().toLowerCase());
}

export interface TechMatch {
  canonical: string;
  category: TechCategory;
  matchedAlias: string;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/** Escapes every regex metacharacter (also `/` and `-`), for building literal-match patterns. */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** Boundary check around a match at [start, end). Right side tolerates sentence punctuation. */
function boundariesOk(text: string, start: number, end: number): boolean {
  const before = start > 0 ? text[start - 1]! : '';
  const after = end < text.length ? text[end]! : '';
  if (before && WORD_CHAR.test(before)) return false;
  if (before === '.' && start > 1 && WORD_CHAR.test(text[start - 2]!)) return false;
  if (after && WORD_CHAR.test(after)) return false;
  // "C++"/"C#"/"R&D": a symbol glued to the alias makes it a different token.
  if (after === '+' || after === '#' || after === '&') return false;
  return true;
}

const CONTEXT_BEFORE = /(?:\b(?:in|using|with|and|or|plus|of|from|stack)\s+|[,/(&]\s*)$/;
const CONTEXT_AFTER =
  /^\s*(?:language\b|lang\b|programming\b|developer\b|backend\b|services?\b|[,/)&])/;
const NOT_TECH_AFTER =
  /^\s+(?:to|for|ahead|back|away|on|through|live|figure|up|out|the)\b/i;

function strictContextOk(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 14), start);
  const after = text.slice(end, end + 14);
  if (NOT_TECH_AFTER.test(after)) return false;
  return CONTEXT_BEFORE.test(before) || CONTEXT_AFTER.test(after);
}

interface CompiledAlias {
  entry: TechEntry;
  re: RegExp;
  strict: boolean;
}

/** Every alias regex is compiled once, at module load. */
const COMPILED: CompiledAlias[] = (() => {
  const out: CompiledAlias[] = [];
  for (const entry of TECH_DICTIONARY) {
    const strict = new Set<string>(entry.strictAliases ?? []);
    const loose = new Set<string>([entry.canonical, ...entry.aliases]);
    for (const s of strict) loose.delete(s);
    for (const alias of loose) {
      out.push({ entry, re: new RegExp(escapeRegex(alias), 'gi'), strict: false });
    }
    for (const alias of strict) {
      out.push({ entry, re: new RegExp(escapeRegex(alias), 'g'), strict: true });
    }
  }
  return out;
})();

/**
 * Finds technologies mentioned in `text`, in order of first appearance, one match per canonical
 * name. Never matches inside longer words; ambiguous names need case + context (see top).
 */
export function findTechnologies(text: string): TechMatch[] {
  if (!text) return [];
  const found = new Map<string, { index: number; match: TechMatch }>();
  for (const c of COMPILED) {
    c.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = c.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (!boundariesOk(text, start, end)) continue;
      if (c.strict && !strictContextOk(text, start, end)) continue;
      const prev = found.get(c.entry.canonical);
      if (!prev || start < prev.index) {
        found.set(c.entry.canonical, {
          index: start,
          match: {
            canonical: c.entry.canonical,
            category: c.entry.category,
            matchedAlias: m[0],
          },
        });
      }
      break;
    }
  }
  return [...found.values()].sort((a, b) => a.index - b.index).map((v) => v.match);
}
