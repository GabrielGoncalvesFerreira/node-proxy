export function parseAxiosError(error) {
  // 1. O Backend respondeu com erro (4xx, 5xx)
  if (error.response) {
    const status = error.response.status;
    const data = error.response.data;

    // Retorna o payload exato que o Laravel mandou (mensagem + errors)
    // Se o Laravel mandou string pura, encapsula em { message }
    return {
      status,
      payload: typeof data === 'object' ? data : { message: data }
    };
  }

  // 2. Sem resposta (Timeout/Rede)
  if (error.request) {
    return {
      status: 503,
      payload: { message: 'Serviço indisponível ou timeout.' }
    };
  }

  // 3. Erro interno do Node
  return {
    status: 500,
    payload: { message: error.message }
  };
}