# JobPilot — Cahier des charges et plan de développement

Nov 5, 2026 · @Raf

## 0. Instructions pour l'assistant IA

Ce document est la source de vérité du projet : l'assistant IA (GPT) le lit en entier avant chaque phase et n'en dévie jamais sans accord explicite du développeur.

### Règles absolues

1. **Aucune action Git ni GitHub.** L'assistant n'exécute jamais `git commit`, `git push`, `git tag`, `gh`, ni aucun appel à l'API GitHub, et ne crée ni branche ni pull request. Seul le développeur versionne et pousse le code.
2. **Une phase à la fois.** L'assistant ne commence une phase qu'après que le développeur a validé et poussé la précédente. Il ne code jamais de fonctionnalité prévue dans une phase ultérieure.
3. **Aucun secret dans le code.** Pas de clé, mot de passe, token ou URL privée en dur, ni dans les tests, ni dans les exemples. Tout passe par des variables d'environnement déclarées dans `.env.example` et validées au démarrage.
4. **Versions figées.** L'assistant utilise les versions de la section 4 ou plus récentes dans la même branche majeure. Il ne change pas de version majeure ni n'ajoute de dépendance sans le justifier et demander l'accord.
5. **Pas d'invention.** Si une information manque (API, comportement attendu), l'assistant pose la question au lieu de supposer. Il ne génère jamais de fausses données d'expérience dans les CV.
6. **Code complet.** L'assistant livre des fichiers entiers et fonctionnels, jamais de `// TODO` ou de `...` à la place du code demandé dans la phase.

### Format de livraison de chaque phase

Chaque phase se termine par un message de l'assistant contenant, dans cet ordre :

1. **Fichiers** : la liste des fichiers créés, modifiés ou supprimés.
2. **Vérification** : les commandes exactes à lancer en local pour valider la phase (installation, lint, tests, démarrage) et le résultat attendu.
3. **Critères d'acceptation** : la liste de la phase, chaque point coché ou expliqué s'il ne l'est pas.
4. **Proposition de commit** : un titre au format Conventional Commits (72 caractères max) et une description, dans un bloc de code, que le développeur relit et utilise lui-même.

Exemple de proposition :

```markdown
feat(api): add job source adapters and Adzuna integration

- Add JobSource interface and normalized JobOffer schema
- Implement AdzunaSource with rate limiting and retries
- Add unit tests with recorded fixtures (no live calls)
- Document ADZUNA_APP_ID and ADZUNA_APP_KEY in .env.example
```

### Conventions de langue

Le code, les noms, les commentaires et les messages de commit sont en anglais (projet open source). L'interface utilisateur est en français par défaut, via un système de traduction qui permet d'ajouter l'anglais plus tard.

## 1. Contexte, objectifs et périmètre

JobPilot est une application web auto-hébergée qui collecte chaque jour des offres d'emploi depuis des sources autorisées, les classe selon le profil de l'utilisateur et génère des CV et lettres de motivation adaptés. Le nom est provisoire et configurable (`APP_NAME`).

### Objectifs du POC

1. Réduire à moins de 15 minutes par jour le temps de veille sur les offres.
2. Ne montrer que les offres pertinentes, avec un score et une explication courte.
3. Produire en un clic un brouillon de CV et de lettre adaptés à une offre, que l'utilisateur relit avant envoi.
4. Suivre ses candidatures (statut, date, relance).
5. Être publiable en open source : sécurisé, documenté, configurable, déployable par un tiers sur son propre serveur.

### Utilisateurs

Le POC sert un seul utilisateur par instance, mais le modèle de données est multi-utilisateur dès le départ : chaque donnée appartient à un `userId` et chaque requête est filtrée par cet identifiant. L'inscription publique est désactivée par défaut (`REGISTRATION_ENABLED=false`) ; le premier compte est créé par une commande CLI.

### Dans le périmètre

- Gestion de plusieurs CV structurés et de plusieurs recherches (postes ciblés).
- Collecte à la demande via un bouton, puis planifiable (cron) en option.
- Sources : API officielles, API publiques d'ATS, alertes e-mail de l'utilisateur.
- Scoring et génération par LLM, avec fournisseur au choix.
- Suivi de candidatures simple (tableau Kanban).
- Déploiement CapRover documenté.

### Hors périmètre

- Scraping de sites dont les conditions d'utilisation l'interdisent (LinkedIn, Indeed, Welcome to the Jungle, APEC…).
- Candidature automatique ou envoi d'e-mails aux recruteurs : l'utilisateur envoie toujours lui-même.
- Application mobile, multi-tenant SaaS, facturation.

## 2. Fonctionnalités détaillées

Chaque fonctionnalité porte un identifiant (F1, F2…) que les phases de la section 10 référencent.

### F1. Authentification et compte

- Connexion e-mail + mot de passe, session par cookie `httpOnly`, `Secure`, `SameSite=Lax`.
- Création du premier compte par CLI (`pnpm --filter api cli user:create`).
- Changement de mot de passe, déconnexion de toutes les sessions.
- Suppression du compte avec effacement complet des données (RGPD).

### F2. CV (profils)

- Plusieurs CV par utilisateur (ex. « Développeur fullstack », « Lead technique »).
- Un CV est stocké en JSON structuré, inspiré du standard [JSON Resume](https://jsonresume.org/schema) : identité, résumé, expériences, formations, compétences, langues, projets, liens.
- Import optionnel d'un PDF existant : le texte est extrait côté serveur puis le LLM propose un JSON que l'utilisateur corrige avant enregistrement.
- Éditeur de formulaire (shadcn) et aperçu PDF.
- Le CV maître n'est jamais modifié par l'IA ; les variantes adaptées sont des copies liées à une offre.

### F3. Recherches (postes ciblés)

- Une recherche = intitulés ciblés, mots-clés obligatoires et exclus, localisations + rayon, télétravail accepté, types de contrat, salaire minimum, séniorité, CV associé.
- Activer ou désactiver une recherche sans la supprimer.
- Choisir les sources utilisées par recherche.

### F4. Collecte des offres

- Bouton « Lancer la collecte » sur le tableau de bord : crée un `CollectionRun` et place une tâche en file d'attente.
- Progression en temps réel (polling toutes les 3 s ou Server-Sent Events) : sources traitées, offres trouvées, nouvelles, doublons, erreurs.
- Une seule collecte en cours par utilisateur ; délai minimal entre deux collectes configurable (`COLLECTION_COOLDOWN_MINUTES`, défaut 30).
- Planification optionnelle (cron configurable par utilisateur, désactivée par défaut).
- Normalisation de toutes les sources vers un schéma `JobOffer` unique et dédoublonnage (section 6).

### F5. Scoring et classement

Le scoring se fait en trois étages pour limiter les coûts LLM :

1. **Filtre dur** (sans IA) : mots exclus, contrat, localisation, salaire minimum si connu.
2. **Similarité sémantique** : embedding de l'offre comparé à l'embedding du CV associé (pgvector, distance cosinus). Seules les N meilleures (`SCORING_LLM_TOP_N`, défaut 30) passent à l'étage 3.
3. **Analyse LLM** : score 0–100, 3 points forts, 3 points de vigilance, compétences manquantes, sortie JSON validée par Zod.

L'utilisateur peut marquer une offre « intéressante », « ignorée » ou « postulée » ; les offres ignorées ne réapparaissent pas.

### F6. Génération de CV et lettre adaptés

- Depuis une offre : générer une variante de CV (réordonnancement, reformulation du résumé et des puces, mise en avant des compétences demandées) et une lettre de motivation.
- Contrainte stricte dans le prompt et vérifiée en code : aucune expérience, entreprise, diplôme, date ou compétence absente du CV maître ne peut apparaître. Une vérification automatique compare les entités de la variante à celles du CV maître et signale tout ajout.
- Paramètres : ton (formel, neutre, direct), longueur, langue (FR/EN).
- Édition manuelle après génération, historique des versions.
- Export PDF (CV et lettre) et copie du texte de la lettre.

### F7. Suivi des candidatures

- Kanban : À postuler → Postulé → Entretien → Offre → Refus.
- Date de candidature, notes, date de relance avec rappel visuel.
- Lien vers l'offre, le CV et la lettre utilisés.

### F8. Paramètres

- Fournisseur LLM et modèles (génération, scoring, embeddings), clés API personnelles chiffrées en base.
- Clés des sources (Adzuna…), liste d'entreprises suivies pour les ATS.
- Boîte e-mail d'alertes (IMAP, lecture seule).
- Export complet des données en JSON.

## 3. Architecture et découpage

Le projet est un monorepo pnpm déployé en cinq apps CapRover : trois apps Node (web, api, worker) et deux services de données (PostgreSQL, Valkey).

&#91;embedded content: architecture · 3 apps Node, 2 services de données, 3 services externes\]

Le worker est séparé de l'API parce que la collecte, les embeddings et le scoring durent plusieurs minutes et appellent des services externes : une collecte lente ou en erreur ne ralentit jamais l'interface. L'API ne fait que déposer des tâches dans Valkey et lire leur avancement.

### Arborescence

```text
jobpilot/
├─ apps/
│  ├─ web/        # Next.js 16, App Router, shadcn, next-intl
│  ├─ api/        # NestJS 12 : HTTP, auth, CRUD, génération
│  └─ worker/     # NestJS 12 standalone : BullMQ, sources, scoring
├─ packages/
│  ├─ shared/     # schémas Zod, types, enums, utilitaires
│  ├─ db/         # schéma Prisma, migrations, client, repositories pgvector
│  ├─ llm/        # interface LlmProvider + implémentations, prompts
│  ├─ sources/    # adaptateurs JobSource (utilisés par le worker)
│  └─ config/     # tsconfig, ESLint, Prettier partagés
├─ docs/          # déploiement, architecture, ajout d'une source
├─ .github/workflows/
├─ docker-compose.yml
└─ .env.example
```

Les paquets `llm` et `sources` sont partagés : l'API en a besoin pour la génération et l'import de CV, le worker pour le scoring et la collecte. Ni web ni worker ne servent de routes publiques autres que celles décrites ; le worker n'est pas exposé du tout.

## 4. Stack technique et versions minimales

Les versions ci-dessous sont les minimums sûrs au 5 novembre 2026 : plusieurs failles critiques ont été corrigées en 2026 et toute version inférieure est interdite. L'assistant vérifie la dernière version de chaque paquet sur npm au début de la phase 1 et fige les versions exactes dans `package.json` et `pnpm-lock.yaml`.

| Brique | Version minimale | Raison |
| --- | --- | --- |
| Node.js | 24.22.1 (LTS) | Correctif de sécurité du 21/10/2026 ([source](https://tech-insider.org/nodejs-lts-24-vs-26-vs-22-which-version-2026/)). Node 26 vient de passer LTS : migration possible plus tard. |
| pnpm | 10.x | Workspaces, `onlyBuiltDependencies` pour bloquer les scripts d'installation. |
| TypeScript | 6.x | Pas TypeScript 7 : la CLI NestJS dépend d'une API de programmation absente de TS 7 ([source](https://github.com/nestjs/nest/pull/16391)). |
| Next.js | 16.4.5 | Correctifs du 3/11/2026, dont une fuite de cache entre utilisateurs ([source](https://docs.pantheon.io/release-notes/2026/11/nextjs-security-release)). |
| React | 19.x (version requise par Next 16.4.5) | Patchs RSC inclus. |
| sharp | 0.35.5 | Réduit la faille RCE de l'optimisation d'images SVG ([source](https://brandefense.io/security-news/next-js-node-js-security-updates-october-2026/)). |
| Tailwind CSS | 4.x | Requis par shadcn CLI v4, configuration en CSS uniquement. |
| shadcn CLI | v4 (`shadcn@latest`) | Compatible Next 16, React 19, Tailwind 4 ([source](https://tech-insider.org/fr/tutoriel-shadcn-ui-v4-saas-auth-13-etapes-2026/)). |
| NestJS | 12.3.x | Branche active ; Nest 11 ne reçoit plus que des correctifs ([source](https://endoflife.date/nestjs)). |
| Prisma ORM | 7.x | Version recommandée en production ([source](https://prisma.io/blog/the-next-evolution-of-prisma-orm)). Pas Prisma Next (accès anticipé). |
| PostgreSQL | 18.4 | Corrige CVE-2026-6478. |
| pgvector | 0.8.2 | Corrige CVE-2026-3172, débordement de tampon lors de la construction d'index HNSW ([source](https://mondoo.com/vulnerability-intelligence/vulnerability/SUSE-SU-2026%3A1068-1)). |
| BullMQ | 6.x | Utiliser uniquement les Job Schedulers ; les anciennes API « repeatable » sont supprimées ([source](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)). |
| Valkey | 8.x | Fork open source (BSD) de Redis, compatible BullMQ. Redis 7.2+ accepté. |
| AI SDK (`ai`) | 6.x | Abstraction multi-fournisseur ; utiliser `generateText` + `Output.object()`, pas `generateObject` (déprécié) ([source](https://antigravity.codes/agent-skills/ai-tools/ai-sdk-core)). |
| Zod | 4.x | Validation partagée front, API, worker et sorties LLM. |

### Bibliothèques complémentaires

- **Front** : TanStack Query (données serveur), React Hook Form + Zod (formulaires), next-intl (traductions), next-themes (mode sombre), Sonner (notifications), dnd-kit (Kanban).
- **API** : `@nestjs/config` avec validation Zod, `@nestjs/throttler`, `helmet`, `argon2`, `nestjs-pino` (logs), `@nestjs/terminus` (health checks), `@nestjs/swagger` (doc OpenAPI en développement seulement).
- **Worker** : `@nestjs/bullmq`, `imapflow` + `mailparser` (alertes e-mail), `undici` (HTTP avec timeouts).
- **Documents** : `@react-pdf/renderer` pour générer les PDF sans navigateur headless ; `unpdf` pour extraire le texte d'un PDF importé.
- **Tests** : Vitest (unitaire), Playwright (e2e front, phase finale uniquement), Testcontainers (Postgres et Valkey réels en tests d'intégration).
- **Qualité** : ESLint 9 (flat config) + Prettier, ou Biome si le développeur le préfère ; Husky + lint-staged.

### Choix du LLM

Le fournisseur est configurable par l'utilisateur ; aucun n'est codé en dur. Les valeurs par défaut proposées :

| Usage | Modèle par défaut | Alternatives |
| --- | --- | --- |
| Génération CV et lettres | Claude Sonnet 5.5 (`claude-sonnet-5-5`) | GPT, Mistral Large, Gemini |
| Scoring, extraction des e-mails | Claude Haiku 5.5 (`claude-haiku-5-5`) | Petits modèles OpenAI, Mistral Small |
| Embeddings | Voyage AI ou OpenAI `text-embedding-3-small` | Mistral Embed, Ollama `bge-m3` (local, gratuit) |

Anthropic ne propose pas de modèle d'embeddings, d'où un fournisseur séparé. La dimension des vecteurs est configurable (`EMBEDDING_DIMENSIONS`, défaut 1024) ; changer de modèle d'embeddings déclenche un recalcul de tous les vecteurs. Le support d'Ollama permet un mode 100 % local sans envoyer le CV à un tiers.

## 5. Sources d'offres et conformité

Chaque source est un adaptateur indépendant qui implémente l'interface `JobSource` ; aucune source n'utilise de scraping HTML.

```ts
interface JobSource {
  readonly id: JobSourceId;            // 'adzuna' | 'greenhouse' | ...
  readonly displayName: string;
  isConfigured(ctx: SourceContext): boolean;
  fetch(criteria: SearchCriteria, ctx: SourceContext): AsyncIterable<RawJobOffer>;
  normalize(raw: RawJobOffer): NormalizedJobOffer; // validé par Zod
}
```

| Source | Phase | Accès | Notes |
| --- | --- | --- | --- |
| Adzuna | 7 | API gratuite, `app_id` + `app_key` | Agrégateur, couverture France correcte, quotas à respecter. |
| Greenhouse | 7 | API publique JSON, sans clé | `boards-api.greenhouse.io/v1/boards/{token}/jobs`, par entreprise suivie. |
| Lever | 7 | API publique JSON, sans clé | `api.lever.co/v0/postings/{company}`. |
| Ashby | 7 | API publique JSON, sans clé | `api.ashbyhq.com/posting-api/job-board/{name}`. |
| Alertes e-mail | 9 | IMAP de l'utilisateur, lecture seule | Alertes LinkedIn, Indeed, WTTJ, APEC reçues sur une boîte dédiée ; extraction par LLM. |
| France Travail | 12 (désactivée) | API suspendue (nov. 2026) | Adaptateur prévu mais désactivé ; activé si l'accès est accordé sur demande. |
| Jooble, Careerjet | Après le POC | Clé partenaire sur demande | Ajout optionnel. |

### Règles de conformité

- Interdiction de scraper un site dont les CGU l'interdisent, et de contourner une protection anti-bot.
- Chaque adaptateur déclare son débit maximal (requêtes par seconde) et le worker le respecte via un limiteur BullMQ.
- User-Agent explicite : `JobPilot/<version> (+<URL du dépôt>)`.
- Timeout de 15 s par requête, 3 tentatives avec backoff exponentiel, puis échec enregistré sans bloquer les autres sources.
- On stocke uniquement les champs utiles à l'offre ; les coordonnées personnelles de recruteurs ne sont pas conservées.
- Les offres de plus de `JOB_RETENTION_DAYS` (défaut 60) sans action de l'utilisateur sont supprimées automatiquement.
- Les e-mails d'alerte sont lus en lecture seule, et seuls ceux des expéditeurs autorisés (`EMAIL_ALERT_ALLOWED_SENDERS`) sont traités. Le contenu des e-mails est considéré comme non fiable (risque d'injection de prompt, voir section 7).

### Schéma normalisé

Toute offre normalisée contient : `sourceId`, `externalId`, `url`, `title`, `company`, `location` (ville, code postal, pays), `remote` (`none`, `hybrid`, `full`, `unknown`), `contractType`, `salaryMin`, `salaryMax`, `salaryCurrency`, `description` (texte nettoyé, HTML retiré), `publishedAt`, `fetchedAt`.

## 6. Modèle de données

Le schéma Prisma vit dans `packages/db` et toutes les tables métier portent un `userId` avec suppression en cascade. Identifiants en UUID v7, dates en `timestamptz`, noms de tables en `snake_case` via `@@map`.

| Entité | Champs principaux | Notes |
| --- | --- | --- |
| `User` | id, email (unique), passwordHash, locale, createdAt | Hash argon2id. |
| `Session` | id, userId, tokenHash, expiresAt, ip, userAgent, lastSeenAt | Seul le hash SHA-256 du token est stocké. |
| `UserSecret` | id, userId, kind (`llm_anthropic`, `adzuna`, `imap`…), ciphertext, iv, authTag, keyVersion | Chiffré AES-256-GCM ; jamais renvoyé en clair au front. |
| `UserSettings` | userId, llmProvider, generationModel, scoringModel, embeddingModel, collectionCron, collectionCooldownMin | Une ligne par utilisateur. |
| `Resume` | id, userId, title, data (JSONB), embedding (vector), isArchived | CV maître, schéma JSON validé par Zod. |
| `Search` | id, userId, resumeId, name, titles\[\], includeKeywords\[\], excludeKeywords\[\], locations (JSONB), radiusKm, remote\[\], contractTypes\[\], salaryMin, sources\[\], isActive | Postes ciblés. |
| `TrackedCompany` | id, userId, name, atsType, atsToken | Pour Greenhouse, Lever, Ashby. |
| `JobOffer` | id, sourceId, externalId, dedupKey, url, title, company, location (JSONB), remote, contractType, salaryMin, salaryMax, description, publishedAt, embedding (vector) | Partagée entre utilisateurs ; unique sur (sourceId, externalId). |
| `UserJobMatch` | id, userId, jobOfferId, searchId, hardFilterPassed, similarity, llmScore, llmAnalysis (JSONB), status (`new`, `interesting`, `ignored`, `applied`) | Lien offre ↔ utilisateur, unique sur (userId, jobOfferId). |
| `CollectionRun` | id, userId, trigger (`manual`, `scheduled`), status, startedAt, finishedAt, stats (JSONB), errors (JSONB) | Une ligne par collecte. |
| `GeneratedDocument` | id, userId, jobOfferId, resumeId, kind (`resume`, `cover_letter`), version, content (JSONB ou texte), params (JSONB), integrityReport (JSONB), model, tokensIn, tokensOut | Historique des versions. |
| `Application` | id, userId, jobOfferId, status, appliedAt, followUpAt, notes, resumeDocId, letterDocId | Kanban. |
| `LlmUsage` | id, userId, purpose, provider, model, tokensIn, tokensOut, costEstimate, createdAt | Suivi des coûts. |
| `AuditLog` | id, userId, action, metadata (JSONB), ip, createdAt | Connexions, changements de secrets, exports, suppressions. |

### Dédoublonnage

`dedupKey` = SHA-256 de `normalize(title) + normalize(company) + normalize(city)`, où `normalize` met en minuscules, retire les accents, la ponctuation et les mentions de genre (« H/F », « (F/H) »). Une offre dont le `dedupKey` existe déjà dans les 30 derniers jours est rattachée à l'offre existante (champ `alternateUrls`) au lieu d'être créée.

### pgvector

Prisma 7 ne gère pas nativement le type `vector`. Les colonnes sont déclarées en `Unsupported("vector(1024)")`, créées par une migration SQL personnalisée (`CREATE EXTENSION IF NOT EXISTS vector`), avec un index HNSW (`vector_cosine_ops`). Les requêtes de similarité passent par `$queryRaw` paramétré (jamais de concaténation de chaînes) ou TypedSQL, encapsulées dans un repository unique.

## 7. Sécurité, RGPD et configuration

Le dépôt étant public, la sécurité repose sur trois principes : aucun secret dans le dépôt, défense en profondeur côté API, et données personnelles minimisées et chiffrées.

### Secrets et configuration

- Toute configuration passe par variables d'environnement, validées par un schéma Zod au démarrage de chaque app : une variable manquante ou invalide arrête le processus avec un message clair.
- `.env`, `.env.*` (sauf `.env.example`) sont dans `.gitignore`. Un hook pre-commit lance `gitleaks protect --staged` et bloque tout secret détecté.
- Les secrets de production sont saisis dans CapRover (variables d'environnement de chaque app) et dans les secrets GitHub Actions, jamais ailleurs.
- Les clés API saisies par l'utilisateur sont chiffrées en AES-256-GCM avec `ENCRYPTION_KEY` (32 octets, base64). Le champ `keyVersion` permet une rotation de clé sans perte.

### Authentification et sessions

- Mots de passe hachés en argon2id (paramètres OWASP : 19 MiB, 2 itérations, 1 thread minimum), longueur minimale 12 caractères.
- Token de session aléatoire de 32 octets ; seul son hash est stocké. Cookie `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, durée glissante 7 jours, absolue 30 jours.
- Protection CSRF : en-tête `X-CSRF-Token` obligatoire sur toute requête non-GET (double-submit cookie), en plus de `SameSite`.
- Limitation de débit : 5 tentatives de connexion par 15 min et par IP + e-mail ; 100 requêtes/min par session sur le reste de l'API.
- Messages d'erreur génériques (« identifiants invalides »), temps de réponse constant.

### API

- `helmet` avec CSP stricte, CORS limité à `WEB_ORIGIN`, taille des corps limitée (1 Mo JSON, 5 Mo upload PDF).
- Validation Zod de toutes les entrées (corps, query, params) grâce au support Standard Schema de NestJS 12.
- Autorisation systématique : chaque requête Prisma filtre par `userId` de la session ; un test vérifie qu'un utilisateur ne peut jamais lire la ressource d'un autre (IDOR).
- Upload PDF : vérification du type MIME réel (signature `%PDF`), taille maximale, traitement en mémoire, fichier jamais servi tel quel.
- Swagger désactivé en production.
- Protection SSRF : les adaptateurs ne contactent que des domaines d'une liste autorisée ; l'hôte IMAP est validé (pas d'IP privée sauf `ALLOW_PRIVATE_IMAP_HOST=true`).

### Front (Next.js)

- Aucun secret côté client : seules les variables `NEXT_PUBLIC_*` explicitement listées sont exposées (URL de l'API, nom de l'app).
- Pas d'Edge runtime ni d'optimisation d'images distantes (`images.unoptimized` ou liste `remotePatterns` vide), ce qui écarte plusieurs failles de 2026.
- Le middleware Next ne sert jamais de seule barrière d'autorisation : l'API vérifie toujours la session.
- En-têtes : CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS (via CapRover/Nginx).

### LLM et injection de prompt

- Les descriptions d'offres et les e-mails sont des données non fiables. Ils sont placés dans des balises délimitées et le prompt système indique de ne jamais suivre d'instructions qu'ils contiennent.
- Les sorties LLM sont toujours validées par Zod ; une sortie invalide est rejetée, jamais exécutée ni rendue en HTML brut.
- Aucun outil (tool calling) n'est donné au LLM : il ne peut ni lire la base, ni envoyer d'e-mail, ni appeler d'URL.
- Plafond de dépense : `LLM_MONTHLY_TOKEN_LIMIT` par utilisateur, vérifié avant chaque appel.

### RGPD et données personnelles

- Le CV est une donnée personnelle : l'utilisateur est informé dans les paramètres du fournisseur LLM utilisé et de la possibilité d'un mode local (Ollama).
- Export complet en JSON et suppression définitive du compte (F1, F8).
- Les logs ne contiennent ni CV, ni contenu de lettre, ni token, ni clé : `pino` avec liste de champs masqués (`redact`).
- Sauvegardes PostgreSQL chiffrées (voir section 9).

### Chaîne d'approvisionnement

- Versions exactes dans le lockfile, `pnpm install --frozen-lockfile` en CI.
- `pnpm audit --prod` et scan OSV en CI ; Dependabot ou Renovate activé par le développeur.
- Actions GitHub épinglées par SHA de commit, permissions minimales (`contents: read`, `packages: write` uniquement pour le job de build).
- Images Docker : base `node:24-alpine` ou distroless, multi-stage, utilisateur non root, `HEALTHCHECK`, scan Trivy en CI.

## 8. Conventions de code et qualité

Le code doit pouvoir être relu par un contributeur externe sans explication : typage strict, modules petits, tests sur la logique métier.

### TypeScript

- `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`. Aucun `any` ; `unknown` + validation Zod à la place.
- Modules ESM partout (NestJS 12 est en ESM).
- Les types partagés (schémas Zod, DTO, enums) vivent dans `packages/shared` et sont importés par web, api et worker ; jamais dupliqués.

### NestJS (api et worker)

- Un module par domaine : `auth`, `users`, `resumes`, `searches`, `jobs`, `matching`, `generation`, `applications`, `settings`, `llm`, `sources`, `crypto`, `health`.
- Contrôleurs fins, logique dans les services, accès base dans des repositories.
- Le paquet `llm` expose une interface `LlmProvider` (`generateStructured`, `generateText`, `embed`) ; aucun autre module n'importe directement le SDK d'un fournisseur.
- Erreurs métier via des exceptions typées et un filtre global qui renvoie `{ error: { code, message } }`, sans stack en production.

### Next.js (web)

- App Router, Server Components par défaut, `"use client"` uniquement pour l'interactivité.
- Composants shadcn installés dans `apps/web/src/components/ui` et jamais modifiés directement ; les variantes métier vont dans `components/`.
- Le front appelle uniquement l'API NestJS, via un client typé généré à partir des schémas partagés. Pas d'accès direct à la base depuis Next.
- Accessibilité : labels sur tous les champs, navigation clavier, contrastes AA.

### Tests

- Couverture minimale de 80 % sur `matching`, `sources` (normalisation, dédoublonnage), `crypto`, `auth` et la vérification d'intégrité des CV générés.
- Aucun appel réseau réel en test : les réponses d'API et de LLM sont des fixtures enregistrées dans `__fixtures__`.
- Tests d'intégration avec Testcontainers (Postgres + pgvector, Valkey).

### Structure Git (appliquée par le développeur)

- Branche `main` protégée, déploiement déclenché par un tag `v*` ou un push sur `main` (au choix, section 9).
- Messages au format Conventional Commits, proposés par l'assistant à chaque fin de phase.
- `CHANGELOG.md` tenu à jour par l'assistant à chaque phase.

## 9. Déploiement CapRover

GitHub Actions construit une image Docker par app, la pousse sur GitHub Container Registry, puis déclenche CapRover avec un token d'app ; l'assistant écrit ces fichiers mais ne les exécute jamais.

### Apps CapRover

| App CapRover | Image | Exposée | Volume persistant |
| --- | --- | --- | --- |
| `jobpilot-web` | `ghcr.io/<owner>/jobpilot-web` | Oui, `jobpilot.<domaine>`, HTTPS forcé | Non |
| `jobpilot-api` | `ghcr.io/<owner>/jobpilot-api` | Oui, `api.jobpilot.<domaine>`, HTTPS forcé | Non |
| `jobpilot-worker` | `ghcr.io/<owner>/jobpilot-worker` | Non (« Do not expose as web app ») | Non |
| `jobpilot-db` | `pgvector/pgvector:0.8.2-pg18` (tag à vérifier) | Non, réseau interne `srv-captain--jobpilot-db` | `/var/lib/postgresql/data` |
| `jobpilot-valkey` | `valkey/valkey:8-alpine` | Non, réseau interne | `/data` |

La base n'utilise pas l'app « one-click PostgreSQL » standard, car elle n'inclut pas pgvector. Postgres et Valkey ne sont jamais exposés sur Internet ; Valkey exige un mot de passe (`--requirepass`).

### Pipeline GitHub Actions

Fichier `.github/workflows/deploy.yml`, déclenché sur tag `v*` (recommandé : le développeur choisit quand déployer) :

1. Job `ci` : install `--frozen-lockfile`, lint, typecheck, tests, `pnpm audit --prod`, gitleaks.
2. Job `build` (matrice web, api, worker) : `docker/build-push-action` vers `ghcr.io`, tag = SHA court + numéro de version, scan Trivy (échec si vulnérabilité critique).
3. Job `deploy` : `caprover/deploy-from-github` avec `server`, `app`, `token` et `image` ([doc CapRover](https://caprover.com/docs/ci-cd-integration/deploy-from-github)), une fois par app, worker et api avant web.

Toutes les actions sont épinglées par SHA de commit, pas par tag.

### Secrets GitHub à créer par le développeur

| Secret | Origine |
| --- | --- |
| `CAPROVER_SERVER` | URL du tableau de bord, ex. `https://captain.<domaine>` |
| `CAPROVER_WEB_TOKEN` | App `jobpilot-web` → Deployment → Enable App Token |
| `CAPROVER_API_TOKEN` | App `jobpilot-api` → Deployment → Enable App Token |
| `CAPROVER_WORKER_TOKEN` | App `jobpilot-worker` → Deployment → Enable App Token |

`GITHUB_TOKEN` suffit pour pousser sur GHCR. Si les images sont privées, ajouter dans CapRover un registre `ghcr.io` avec un token GitHub limité à `read:packages`. Dépôt public : les packages peuvent être rendus publics et aucun registre n'est nécessaire.

### Fichiers de déploiement

- `apps/*/Dockerfile` : multi-stage, `pnpm deploy --prod` pour n'embarquer que les dépendances de l'app, utilisateur `node`, `HEALTHCHECK`.
- `apps/web` : `output: "standalone"` dans `next.config.ts`.
- `apps/api` : au démarrage, `prisma migrate deploy` puis lancement du serveur ; le worker n'exécute jamais de migration.
- `captain-definition` par app pointant sur l'image (utilisé uniquement en déploiement manuel de secours).
- `docker-compose.yml` à la racine pour le développement local (Postgres pgvector + Valkey + Mailpit pour tester l'IMAP).

### Cookies entre sous-domaines

`jobpilot.<domaine>` et `api.jobpilot.<domaine>` sont du même site : le cookie de session posé par l'API avec `SameSite=Lax` est envoyé par `fetch(..., { credentials: "include" })`. CORS de l'API : `origin = WEB_ORIGIN` exact, `credentials: true`.

### Sauvegardes

Une tâche planifiée du worker lance chaque nuit `pg_dump`, chiffre le fichier avec `age` (clé publique `BACKUP_AGE_RECIPIENT`) et le dépose dans un stockage S3 compatible configurable. Sans configuration S3, la sauvegarde reste désactivée et un avertissement s'affiche dans les paramètres. Le `README` documente la restauration.

## 10. Plan de développement par phases

Le projet se construit en 13 phases séquentielles ; le déploiement arrive tôt (phase 4) pour tester chaque fonctionnalité sur le VPS dès qu'elle existe. À la fin de chaque phase, l'assistant livre le message décrit en section 0 et s'arrête.

### Phase 0 — Monorepo et outillage

Objectif : un dépôt vide mais professionnel, prêt à accueillir le code.

- pnpm workspaces + Turborepo : `apps/web`, `apps/api`, `apps/worker`, `packages/shared`, `packages/db`, `packages/llm`, `packages/sources`, `packages/config` (tsconfig, ESLint, Prettier partagés).
- `.nvmrc` (24.22.1), `packageManager` figé, `.editorconfig`, `.gitignore`, `.env.example`.
- `docker-compose.yml` : Postgres 18 + pgvector, Valkey 8, Mailpit.
- Husky + lint-staged + gitleaks, commitlint (Conventional Commits).
- Workflow `ci.yml` (lint, typecheck, test, audit) sans déploiement.
- `README.md`, `LICENSE` (AGPL-3.0 recommandée pour un outil auto-hébergé, ou MIT : choix du développeur), `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `CHANGELOG.md`.

Critères d'acceptation :

- [ ] `pnpm install && pnpm lint && pnpm typecheck` passent sur un clone propre.
- [ ] `docker compose up -d` démarre Postgres, Valkey et Mailpit.
- [ ] Un faux secret ajouté dans un fichier est bloqué par le hook pre-commit.

Commit indicatif : `chore: bootstrap monorepo with tooling and local infrastructure`

### Phase 1 — Base de données et types partagés

Objectif : le schéma complet de la section 6, migré et typé.

- `packages/db` : schéma Prisma 7, migration initiale, migration SQL pgvector (extension, colonnes, index HNSW), client exporté, repository de similarité vectorielle.
- `packages/shared` : schémas Zod (CV au format JSON Resume, recherche, offre normalisée, analyse LLM, paramètres), enums, utilitaires (`normalizeText`, `computeDedupKey`).
- Script de seed de développement (un utilisateur, un CV fictif, deux recherches).

Critères d'acceptation :

- [ ] `pnpm db:migrate` crée toutes les tables et l'extension `vector`.
- [ ] Tests unitaires de `computeDedupKey` (accents, « H/F », casse, ponctuation).
- [ ] Test d'intégration : insertion de deux embeddings et requête du plus proche.

Commit indicatif : `feat(db): add Prisma schema, pgvector migration and shared Zod schemas`

### Phase 2 — Socle API et authentification (F1)

Objectif : une API NestJS sécurisée avec connexion fonctionnelle.

- Bootstrap NestJS 12 : config validée, `helmet`, CORS, throttler, `nestjs-pino` avec masquage, filtre d'erreurs global, `/health` (base + Valkey).
- Module `crypto` (AES-256-GCM, rotation via `keyVersion`).
- Module `auth` : login, logout, logout-all, `me`, changement de mot de passe, sessions en base, CSRF double-submit, rate limit de connexion.
- CLI `user:create` et `user:reset-password`.
- Suppression de compte et export JSON (F1, F8).

Critères d'acceptation :

- [ ] Tests : mauvais mot de passe, session expirée, absence de token CSRF, 6e tentative bloquée.
- [ ] Test IDOR générique réutilisable pour les phases suivantes.
- [ ] Aucun secret ni hash visible dans les logs.

Commit indicatif : `feat(api): add secure session auth, crypto module and health checks`

### Phase 3 — Socle web

Objectif : l'interface de base avec shadcn, connectée à l'API.

- Next.js 16.4.5+, Tailwind 4, `shadcn init`, composants : button, input, form, card, dialog, sheet, table, tabs, badge, sonner, dropdown-menu, sidebar, skeleton, progress.
- Layout avec sidebar (Tableau de bord, Offres, CV, Recherches, Candidatures, Paramètres), mode sombre, next-intl (fr par défaut).
- Page de connexion, protection des routes, client API typé avec gestion du CSRF, TanStack Query.
- Tableau de bord vide avec emplacement du bouton de collecte.
- En-têtes de sécurité et CSP dans `next.config.ts`.

Critères d'acceptation :

- [ ] Connexion, déconnexion, redirection si non connecté.
- [ ] Lighthouse accessibilité ≥ 90 sur la page de connexion.
- [ ] Aucune variable non `NEXT_PUBLIC_` dans le bundle client.

Commit indicatif : `feat(web): add Next.js shell with shadcn layout and authentication`

### Phase 4 — Déploiement CapRover et CI/CD

Objectif : le socle tourne sur le VPS, déployé par tag.

- Dockerfiles des trois apps, `captain-definition`, workflow `deploy.yml` (section 9), scan Trivy.
- Guide pas à pas `docs/deployment-caprover.md` : création des 5 apps, volumes, variables, tokens, domaines, HTTPS.
- Le worker démarre et répond à un health check interne (aucune tâche encore).

Critères d'acceptation :

- [ ] Les trois images se construisent en local avec `docker build`.
- [ ] Les conteneurs tournent en utilisateur non root.
- [ ] Le guide permet à un tiers de déployer sans autre information.

Commit indicatif : `ci: add Docker images and CapRover deployment workflow`

### Phase 5 — CV, recherches et paramètres (F2, F3, F8)

Objectif : saisir toutes ses données de recherche.

- CRUD CV avec éditeur de formulaire par sections et aperçu.
- CRUD recherches avec choix du CV et des sources.
- Paramètres : fournisseur et modèles LLM, clés API (champ masqué, écriture seule), entreprises suivies (ATS), IMAP.
- Export PDF du CV maître avec `@react-pdf/renderer` (un modèle sobre, compatible ATS : texte sélectionnable, une colonne).

Critères d'acceptation :

- [ ] Une clé API enregistrée n'est jamais renvoyée par l'API (seulement `configured: true` et les 4 derniers caractères).
- [ ] Tests IDOR sur CV, recherches et secrets.
- [ ] Le PDF généré est lisible par un extracteur de texte.

Commit indicatif : `feat: add resumes, searches and encrypted user settings`

### Phase 6 — Module LLM et import de CV

Objectif : une couche IA unique, sûre et mesurée.

- Paquet `packages/llm` sur AI SDK 6, intégré à l'API et au worker par un module Nest : fournisseurs Anthropic, OpenAI, Mistral, Ollama ; `generateStructured` avec `Output.object()` + Zod, `embed`.
- Enregistrement `LlmUsage`, plafond mensuel, timeouts, nouvelles tentatives limitées.
- Gabarits de prompts versionnés dans `packages/llm/src/prompts/`, avec délimitation des données non fiables.
- Import PDF de CV : extraction du texte, proposition JSON, écran de validation.
- Calcul de l'embedding du CV à chaque enregistrement.

Critères d'acceptation :

- [ ] Changer de fournisseur dans les paramètres ne demande aucune modification de code.
- [ ] Une sortie LLM non conforme au schéma est rejetée proprement.
- [ ] Test d'injection : une offre contenant « ignore les instructions précédentes » ne modifie pas le format de sortie.

Commit indicatif : `feat(api): add provider-agnostic LLM module and resume import`

### Phase 7 — Worker et collecte des offres (F4)

Objectif : le bouton du matin fonctionne.

- Worker NestJS + BullMQ 6 : files `collection`, `embedding`, `scoring`.
- Adaptateurs Adzuna, Greenhouse, Lever, Ashby (section 5), limiteurs de débit, gestion d'erreurs par source.
- Normalisation, dédoublonnage, calcul des embeddings des offres.
- Endpoint `POST /collections` (cooldown, une seule collecte active), `GET /collections/:id` + SSE de progression.
- Bouton et panneau de progression sur le tableau de bord.

Critères d'acceptation :

- [ ] Tests de normalisation avec fixtures réelles anonymisées pour chaque source.
- [ ] Une source en erreur n'interrompt pas les autres ; l'erreur s'affiche dans le rapport.
- [ ] Deux clics rapides ne lancent qu'une collecte.

Commit indicatif : `feat(worker): add job collection pipeline with API source adapters`

### Phase 8 — Scoring et liste des offres (F5)

Objectif : ne voir que les offres pertinentes, expliquées.

- Pipeline en trois étages (filtre dur, similarité, analyse LLM des N meilleures).
- Page Offres : tableau filtrable (score, recherche, source, date, statut), fiche détaillée avec analyse, actions intéressante / ignorée.
- Résumé de la collecte sur le tableau de bord (nouvelles offres, meilleures correspondances).

Critères d'acceptation :

- [ ] Les offres ignorées ne réapparaissent pas aux collectes suivantes.
- [ ] Au plus `SCORING_LLM_TOP_N` appels LLM par collecte et par recherche.
- [ ] Tests unitaires du filtre dur.

Commit indicatif : `feat: add three-stage job scoring and offers dashboard`

### Phase 9 — Alertes e-mail (source IMAP)

Objectif : récupérer les offres de LinkedIn, Indeed, WTTJ, APEC via ses propres alertes.

- Adaptateur `EmailAlertSource` : connexion IMAP TLS en lecture seule, filtrage par expéditeurs autorisés, marquage des messages traités par UID (pas de suppression).
- Extraction des offres par LLM (petit modèle) avec schéma Zod ; liens nettoyés des paramètres de tracking.
- Test local avec Mailpit et des e-mails d'exemple anonymisés.

Critères d'acceptation :

- [ ] Un e-mail d'un expéditeur non autorisé est ignoré.
- [ ] Un même e-mail n'est jamais traité deux fois.
- [ ] Le mot de passe IMAP est stocké chiffré.

Commit indicatif : `feat(worker): add read-only IMAP job alert source`

### Phase 10 — Génération de CV et lettres (F6)

Objectif : un brouillon adapté en un clic, sans invention.

- Génération de variante de CV et de lettre depuis une offre, paramètres de ton, longueur, langue.
- Vérification d'intégrité : comparaison des entreprises, intitulés, dates, diplômes et compétences avec le CV maître ; tout ajout est signalé en rouge et bloque l'export tant qu'il n'est pas validé manuellement.
- Éditeur, historique des versions, export PDF, copie du texte.

Critères d'acceptation :

- [ ] Test : une variante contenant une entreprise absente du CV maître est signalée.
- [ ] Le CV maître reste inchangé après génération.
- [ ] Les coûts de chaque génération sont visibles.

Commit indicatif : `feat: add tailored resume and cover letter generation with integrity check`

### Phase 11 — Suivi des candidatures (F7)

Objectif : savoir où en est chaque candidature.

- Kanban drag-and-drop accessible au clavier, création depuis une offre, notes, date de relance avec badge « à relancer ».
- Rattachement du CV et de la lettre utilisés.

Critères d'acceptation :

- [ ] Passer une offre en « postulée » crée la candidature correspondante.
- [ ] Le Kanban fonctionne sans souris.

Commit indicatif : `feat(web): add application tracking board`

### Phase 12 — Planification, sauvegardes et publication open source

Objectif : un projet fiable au quotidien et publiable.

- Collecte planifiée optionnelle par utilisateur (Job Scheduler BullMQ), purge des offres anciennes.
- Sauvegardes chiffrées (section 9) et procédure de restauration testée.
- Tests e2e Playwright du parcours principal (connexion → collecte → offre → génération → candidature) avec sources et LLM simulés.
- Revue de sécurité complète selon la checklist de l'annexe, captures d'écran et documentation utilisateur.
- Adaptateur France Travail prêt mais désactivé par défaut.

Critères d'acceptation :

- [ ] Restauration d'une sauvegarde vérifiée sur une base vide.
- [ ] Checklist open source de l'annexe entièrement cochée.

Commit indicatif : `feat: add scheduled collection, encrypted backups and e2e tests`

## 11. Annexes

### A. Variables d'environnement

Toutes figurent dans `.env.example` avec une valeur fictive et un commentaire ; l'app concernée refuse de démarrer si une variable requise manque.

| Variable | Apps | Requise | Exemple / défaut |
| --- | --- | --- | --- |
| `NODE_ENV` | toutes | oui | `production` |
| `APP_NAME` | web, api | non | `JobPilot` |
| `DATABASE_URL` | api, worker | oui | `postgresql://jobpilot:***@srv-captain--jobpilot-db:5432/jobpilot` |
| `VALKEY_URL` | api, worker | oui | `redis://:***@srv-captain--jobpilot-valkey:6379` |
| `ENCRYPTION_KEY` | api, worker | oui | 32 octets en base64 (`openssl rand -base64 32`) |
| `SESSION_SECRET` | api | oui | 32 octets en base64 |
| `WEB_ORIGIN` | api | oui | `https://jobpilot.example.com` |
| `COOKIE_DOMAIN` | api | non | `jobpilot.example.com` |
| `NEXT_PUBLIC_API_URL` | web | oui | `https://api.jobpilot.example.com` |
| `REGISTRATION_ENABLED` | api | non | `false` |
| `COLLECTION_COOLDOWN_MINUTES` | api | non | `30` |
| `SCORING_LLM_TOP_N` | worker | non | `30` |
| `JOB_RETENTION_DAYS` | worker | non | `60` |
| `EMBEDDING_DIMENSIONS` | api, worker | non | `1024` |
| `LLM_MONTHLY_TOKEN_LIMIT` | api, worker | non | `2000000` |
| `DEFAULT_LLM_PROVIDER` | api, worker | non | `anthropic` |
| `OLLAMA_BASE_URL` | api, worker | non | `http://srv-captain--ollama:11434` |
| `EMAIL_ALERT_ALLOWED_SENDERS` | worker | non | `jobalerts-noreply@linkedin.com,alert@indeed.com` |
| `ALLOW_PRIVATE_IMAP_HOST` | worker | non | `false` (`true` en local avec Mailpit) |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY` | worker | non | Vide = sauvegardes désactivées |
| `BACKUP_AGE_RECIPIENT` | worker | non | Clé publique `age1...` |
| `LOG_LEVEL` | toutes | non | `info` |

Les clés des fournisseurs LLM et d'Adzuna ne sont pas des variables d'environnement : chaque utilisateur les saisit dans ses paramètres, chiffrées en base. Une instance peut toutefois définir des clés par défaut (`DEFAULT_ANTHROPIC_API_KEY`, etc.) pour un usage personnel.

### B. Checklist avant publication open source

- [ ] `gitleaks detect` sur tout l'historique Git : aucun secret, même supprimé.
- [ ] Aucune donnée personnelle réelle (CV, e-mails, offres) dans les fixtures ou les captures.
- [ ] `pnpm audit --prod` et Trivy sans vulnérabilité haute ou critique.
- [ ] Versions de Next.js, Node.js, PostgreSQL et pgvector revérifiées contre les derniers avis de sécurité.
- [ ] `SECURITY.md` indique comment signaler une faille en privé (GitHub Security Advisories).
- [ ] Le README explique les sources autorisées et interdit explicitement l'ajout de scrapers violant des CGU.
- [ ] Installation testée de zéro par une personne tierce avec le guide CapRover.
- [ ] Licence choisie et en-tête de licence cohérent.
- [ ] Captures d'écran et démo avec des données fictives.

### C. Sources

- [Avis de sécurité Next.js novembre 2026](https://docs.pantheon.io/release-notes/2026/11/nextjs-security-release)
- [Avis Next.js et Node.js octobre 2026](https://brandefense.io/security-news/next-js-node-js-security-updates-october-2026/)
- [Versions LTS de Node.js au 28/10/2026](https://tech-insider.org/nodejs-lts-24-vs-26-vs-22-which-version-2026/)
- [Cycle de vie NestJS](https://endoflife.date/nestjs)
- [PR NestJS 12 (TypeScript 7)](https://github.com/nestjs/nest/pull/16391)
- [Prisma 7 et Prisma Next](https://prisma.io/blog/the-next-evolution-of-prisma-orm)
- [Faille pgvector CVE-2026-3172](https://mondoo.com/vulnerability-intelligence/vulnerability/SUSE-SU-2026%3A1068-1)
- [Migration BullMQ v5 vers v6](https://docs.bullmq.io/guide/migrations/migrate-from-v5-to-v6)
- [shadcn CLI v4](https://tech-insider.org/fr/tutoriel-shadcn-ui-v4-saas-auth-13-etapes-2026/)
- [AI SDK 6 et Output API](https://antigravity.codes/agent-skills/ai-tools/ai-sdk-core)
- [CapRover : déploiement depuis GitHub](https://caprover.com/docs/ci-cd-integration/deploy-from-github)
