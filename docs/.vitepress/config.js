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
            collapsed: false,
            items: [
              { text: 'Item Collection', link: '/design/representation/item_collection' },
              { text: 'Item Store', link: '/design/representation/item_store' },
              { text: 'Proxy Collection', link: '/design/representation/proxy_collection' }
            ]
          },
          {
            text: 'Mechanism',
            collapsed: false,
            items: [
              { text: 'Communication', link: '/design/mechanism/communication' },
              { text: 'Subscriptions', link: '/design/mechanism/subscriptions' },
              { text: 'Consistency', link: '/design/mechanism/consistency' }
            ]
          },
          {
            text: 'Abstraction',
            collapsed: false,
            items: [
              { text: 'Connection', link: '/design/abstraction/connection' },
              { text: 'Application Objects', link: '/design/abstraction/app_objects' },
              { text: 'Shared Clock', link: '/design/abstraction/clock' }
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
