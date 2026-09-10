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
          { text: 'Overview', docFooterText: 'Design Overview', link: '/design/overview' },
          {
            text: 'Representation',
            collapsed: true,
            items: [
              { text: 'Item Collection Design', link: '/design/representation/item_collection' },
              { text: 'Item Store Design ', link: '/design/representation/item_store' },
              { text: 'Item Provider Design', link: '/design/representation/item_provider' }
            ]
          },
          {
            text: 'Mechanism',
            collapsed: true,
            items: [
              { text: 'Communication Design', link: '/design/mechanism/communication' },
              { text: 'Subscriptions Design', link: '/design/mechanism/subscriptions' },
              { text: 'Consistency Design', link: '/design/mechanism/consistency' }
            ]
          },
          {
            text: 'Abstraction',
            collapsed: true,
            items: [
              { text: 'Shared Objects Design', link: '/design/abstraction/objects' },
              { text: 'Connection Design', link: '/design/abstraction/connection' },
              { text: 'Server Clock Design', link: '/design/abstraction/clock' }
            ]
          }
        ]
      },
      {
        text: 'Client API',
        items: [
          { text: 'Overview', docFooterText: 'Client API Overview', link: '/client_api/overview' },
          { text: 'Types & Structures', link: '/client_api/types' },
          {
            text: 'Client',
            collapsed: true,
            items: [
              { text: 'SharedStateClient API', link: '/client_api/client' },
              { text: 'Connection API', link: '/client_api/connection' },
              { text: 'ServerClock API', link: '/client_api/clock' }
            ]
          },
          {
            text: 'Resources',
            collapsed: true,
            items: [
              { text: 'CollectionResource API', link: '/client_api/collection_resource' },
              { text: 'ValueResource API', link: '/client_api/value_resource' }
            ]
          },
          {
            text: 'Shared Objects',
            collapsed: true,
            items: [
              { text: 'Event API', link: '/client_api/events' },
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
