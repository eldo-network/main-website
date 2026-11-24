// Static site: everything is served from public/.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
