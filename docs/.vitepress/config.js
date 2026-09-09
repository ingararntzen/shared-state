import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SharedState',
  description: 'Python server and JavaScript client for real-time data sharing.',
  base: '/shared-state/',

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/shared-state/logo.svg' }]
  ],

  themeConfig: {
    logo: '/logo.svg',
    nav: [],

    sidebar: [
      {
        text: 'Usage',
        items: [
          { text: 'Quickstart', link: '/usage/quickstart' },
          { text: 'Server', link: '/usage/server' },
          { text: 'Client', link: '/usage/client' },
          { text: 'Example', link: '/usage/example' }
        ]
      },
      {
        text: 'Concept',
        items: [
          { text: 'Introduction', link: '/concept/introduction' },
          { text: 'Architecture', link: '/concept/architecture' },
          { text: 'Replication', link: '/concept/replication' },
          { text: 'Consistency', link: '/concept/consistency' }
        ]
      },
      {
        text: 'Design',
        items: [
          { text: 'Overview', link: '/design/overview' },
          {
            text: 'Representation',
            collapsed: true,
            items: [
              { text: 'Item Collection', link: '/design/representation/item_collection' },
              { text: 'Item Store', link: '/design/representation/item_store' },
              { text: 'Item Provider', link: '/design/representation/item_provider' }
            ]
          },
          {
            text: 'Mechanism',
            collapsed: true,
            items: [
              { text: 'Communication', link: '/design/mechanism/communication' },
              { text: 'Subscriptions', link: '/design/mechanism/subscriptions' },
              { text: 'Consistency', link: '/design/mechanism/consistency' }
            ]
          },
          {
            text: 'Abstraction',
            collapsed: true,
            items: [
              { text: 'Connection', link: '/design/abstraction/connection' },
              { text: 'Application Objects', link: '/design/abstraction/objects' },
              { text: 'Shared Clock', link: '/design/abstraction/clock' }
            ]
          }
        ]
      },
      {
        text: 'Client API',
        items: [
          { text: 'Overview', link: '/client_api/overview' },
          {
            text: 'Client API',
            collapsed: true,
            items: [
              { text: 'SharedStateClient API', link: '/client_api/client' },
              { text: 'Connection API', link: '/client_api/connection' },
              { text: 'ServerClock API', link: '/client_api/clock' }
            ]
          },
          {
            text: 'Objects API',
            collapsed: true,
            items: [
              { text: 'Events API', link: '/client_api/events' },
              { text: 'SharedVariables API', link: '/client_api/variables' },
              { text: 'SharedMap API', link: '/client_api/map' },
              { text: 'SharedSet API', link: '/client_api/set' }
            ]
          }
        ]
      }
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ingararntzen/shared-state' }
    ],

    footer: {
      message: 'Released under the BSD-2-Clause License.',
      copyright: 'Copyright © Ingar M. Arntzen'
    }
  }
})
