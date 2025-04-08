
# JavaScript Client build process

```sh

# install
npm install

# build to html/libs
npm run build

# build including minimized
npm run build:dist

# start dev webserver
npm start

# deploy (main branch)
cp html/libs/*.js libs
```

# Server Testing

```sh
poetry run pytest
```

