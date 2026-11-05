import type { Resume } from '@jobpilot/shared';
// Fictional data used only to verify document layout and text extraction.
export const syntheticResume: Resume = {
  basics: {
    name: 'Camille Exemple',
    label: 'Développeuse logiciel',
    email: 'camille@example.invalid',
    phone: '+33 0 00 00 00 00',
    summary:
      'Développeuse attentive à la qualité, à l’accessibilité et à la fiabilité des logiciels.',
    location: { city: 'Lyon', postalCode: '69000', country: 'FR' },
    url: 'https://example.invalid/portfolio',
    profiles: [
      {
        network: 'Portfolio',
        username: 'camille',
        url: 'https://example.invalid/projets',
      },
    ],
  },
  work: [
    {
      name: 'Entreprise Exemple',
      position: 'Développeuse TypeScript',
      startDate: '2022-03',
      endDate: '2025-09',
      summary: 'Conception et maintenance d’applications métier.',
      highlights: [
        'Amélioration de l’accessibilité des formulaires.',
        'Mise en place de tests de non-régression.',
      ],
    },
  ],
  education: [
    {
      institution: 'École Exemple',
      area: 'Informatique',
      studyType: 'Master',
      startDate: '2020',
      endDate: '2022',
      courses: ['Architecture logicielle', 'Qualité et sécurité'],
    },
  ],
  skills: [
    {
      name: 'Développement',
      level: 'Confirmé',
      keywords: ['TypeScript', 'PostgreSQL', 'Tests'],
    },
  ],
  languages: [
    { language: 'Français', fluency: 'Courant' },
    { language: 'Anglais', fluency: 'Professionnel' },
  ],
  projects: [
    {
      name: 'Projet de démonstration',
      description: 'Outil fictif de suivi documentaire.',
      url: 'https://example.invalid/demo',
      highlights: ['Documentation accessible et structurée.'],
    },
  ],
};
