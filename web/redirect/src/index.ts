const redirectWorker = {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    url.protocol = "https:";
    url.host = "codewhale.net";
    return Response.redirect(url.toString(), 301);
  },
};

export default redirectWorker;
