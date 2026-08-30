import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'SharedState',
  description: 'Python server and JavaScript client for real-time data sharing.',
  base: '/shared-state/',

  themeConfig: {
    logo: '/logo.svg',
    nav: [],

    sidebar: [
      {
        text: 'Concept',
        items: [
          { text: 'Paradigm', link: '/concept/paradigm' },
          { text: 'Architecture', link: '/concept/architecture' },
          { text: 'Replication', link: '/concept/replication' },
          { text: 'Consistency', link: '/concept/consistency' },
          { text: 'Semantics', link: '/concept/semantics' }
        ]
      },
      {
        text: 'Design',
        items: [
          { text: 'Overview', link: '/design/overview' },
          {
            text: 'Item Collections',
            collapsed: false,
            items: [
              { text: 'Item Collection', link: '/design/item_collections/item_collection' },
              { text: 'Server Stores', link: '/design/item_collections/server_stores' },
              { text: 'Client Proxies', link: '/design/item_collections/client_proxies' }
            ]
          },
          {
            text: 'Internals',
            collapsed: false,
            items: [
              { text: 'Communication', link: '/design/internals/communication' },
              { text: 'Subscriptions', link: '/design/internals/subscriptions' },
              { text: 'Consistency', link: '/design/internals/consistency' }
            ]
          },
          {
            text: 'Abstractions',
            collapsed: false,
            items: [
              { text: 'Connection', link: '/design/abstractions/connection' },
              { text: 'Shared Variables', link: '/design/abstractions/variables' },
              { text: 'Shared Collections', link: '/design/abstractions/collections' },
              { text: 'Shared Clock', link: '/design/abstractions/clock' }
            ]
          }
        ]
      },
      {
        text: 'JavaScript Client API',
        items: [
          { text: 'Client Overview', link: '/client-api/' },
          { text: 'SharedStateClient', link: '/client-api/sharedstate-client' },
          { text: 'ProxyCollection', link: '/client-api/proxy-collection' },
          { text: 'ServerClock', link: '/client-api/server-clock' }
        ]
      },
      {
        text: 'Server & Administration',
        items: [
          { text: 'Server Setup & CLI', link: '/server-admin/' },
          { text: 'Configuration Schema', link: '/server-admin/config' },
          { text: 'HTTP REST & Admin Endpoints', link: '/server-admin/rest-api' }
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
