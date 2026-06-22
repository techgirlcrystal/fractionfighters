FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY manifest.json /usr/share/nginx/html/manifest.json
COPY sw.js /usr/share/nginx/html/sw.js
COPY icon.svg /usr/share/nginx/html/icon.svg
COPY icon-192.png /usr/share/nginx/html/icon-192.png
COPY icon-512.png /usr/share/nginx/html/icon-512.png
COPY apple-touch-icon.png /usr/share/nginx/html/apple-touch-icon.png
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
