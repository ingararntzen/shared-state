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
          { text: 'Design Overview', link: '/design/framework' },
          { text: 'Item Collections', link: '/design/resources' },
          { text: 'Subscriptions', link: '/design/subscriptions' },
          { text: 'Proxies', link: '/design/proxies' },
          { text: 'Stores', link: '/design/stores' },
          { text: 'Clock', link: '/design/clock' },
          { text: 'Connection', link: '/design/connection' },
          { text: 'Messages', link: '/design/messages' },
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
