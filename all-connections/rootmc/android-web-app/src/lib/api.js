import axios from "axios";
import { USE_MOCK } from "./rootmc-api";
import { liveGet, livePost } from "./live-api";

const mockApi = axios.create({
  baseURL: `${process.env.REACT_APP_BACKEND_URL}/api`,
  timeout: 20000,
});

mockApi.interceptors.request.use((config) => {
  const token = localStorage.getItem("rootmc_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

async function routeGet(path, config) {
  if (!USE_MOCK) return liveGet(path, config);
  return mockApi.get(path, config);
}

async function routePost(path, body, config) {
  if (!USE_MOCK) return livePost(path, body);
  return mockApi.post(path, body, config);
}

export const api = {
  get: (path, config) => routeGet(path, config),
  post: (path, body, config) => routePost(path, body, config),
};

export const setToken = (t) => {
  if (t) localStorage.setItem("rootmc_token", t);
  else localStorage.removeItem("rootmc_token");
};

export const getToken = () => localStorage.getItem("rootmc_token");
