// Estado compartido de la sesión.
export const state = {
  user: null,
  settings: null,
};

export const isAdmin = () => state.user?.role === 'admin';
