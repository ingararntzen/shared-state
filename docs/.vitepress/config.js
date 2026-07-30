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
        text: 'Overview',
        items: [
          { text: 'SharedState Paradigm', link: '/overview/paradigm' },
          { text: 'SharedState Architecture', link: '/overview/architecture' }
        ]
      },
      {
        text: 'Design',
        items: [
          { text: 'Resources', link: '/design/resources' },
          { text: 'Updates', link: '/design/update' },
          { text: 'Subscriptions', link: '/design/subscriptions' },
          { text: 'Client Proxies', link: '/design/proxies' },
          { text: 'Network Communication', link: '/design/websocket' },
          { text: 'Server Stores', link: '/design/stores' },
          { text: 'Server Clock', link: '/design/server-clock' },

          { text: '8. Resource Lifecycle', link: '/design/lifecycle' },
          { text: '9. Unified Single-Port', link: '/design/single-port' },
          { text: '11. Hierarchical Namespace', link: '/design/namespace' }
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
