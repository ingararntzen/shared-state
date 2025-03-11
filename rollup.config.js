// rollup.config.js

// minifying code
import terser from '@rollup/plugin-terser';

// plugins for different module types
// needed if src includes non-ES6 modules
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';

// dev support
import serve from 'rollup-plugin-serve';
import livereload from 'rollup-plugin-livereload';

// distribution
const isDist = process.env.DIST == 'true';
const isServe = process.env.SERVE == 'true';

// target directory for build
const target = "html/libs";
// name of bundle
const bundle = "sharedstate";
// file extension
const ext = isDist ? "min.js" : "js"; 

export default {
  input: 'src/client/index.js',
  output: [
    {
      file: `${target}/${bundle}.iife.${ext}`,
      format: 'iife',
      sourcemap: "inline",
      name: `${bundle.toLocaleUpperCase()}`,
    },
    {
      file: `${target}/${bundle}.es.${ext}`,
      format: 'es',
    },
  ],
  external: [],
  plugins: [
    resolve(),
    commonjs(),
    isDist && terser(),
    // start dev server and open browser
    !isDist && isServe && serve({
      open: true, // Opens the browser automatically
      contentBase: 'html',
      port: 8000,
    }),
    // dev server livereload browser
    !isDist && isServe && livereload({watch : 'html'}),
  ],
}


