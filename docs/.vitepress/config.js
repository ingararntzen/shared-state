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
          { text: 'Replication Strategy', link: '/concept/replication' }
        ]
      },
      {
        text: 'Design',
        items: [
          { text: 'Overview', link: '/design/framework' },
          { text: 'Item Collections', link: '/design/collections' },
          { text: 'Item Store', link: '/design/stores' },
          { text: 'Connection', link: '/design/connection' },
          { text: 'Communication', link: '/design/communication' },
          { text: 'Subscriptions', link: '/design/subscriptions' },
          { text: 'Server Clock', link: '/design/clock' },
          { text: 'Proxy Objects', link: '/design/proxyobjects' },
        ]
      },
      {
        text: 'JavaScript Client API',
        items: [
          { text: 'Client Overview', link: '/client-api/' },
          { text: 'SharedStateClient', link: '/client-api/sharedstate-client' },
          { text: 'ProxyCollection', link: '/client-api/proxy-collection' },
          { text: 'ProxyObject', link: '/client-api/proxy-object' },
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
