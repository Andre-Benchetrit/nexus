const definicaoGerarImagem = Object.freeze({
  type: 'function', name: 'gerar_imagem', strict: true,
  description: 'Cria ou edita uma imagem privada em camadas. A logo é opcional e só pode ser habilitada quando solicitada.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      action: { type: 'string', enum: ['generate', 'edit', 'variation'] },
      title: { type: 'string', minLength: 1, maxLength: 180 },
      prompt: { type: 'string', minLength: 1, maxLength: 12000 },
      format: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
      preset: { type: 'string', enum: ['square', 'portrait', 'story', 'landscape'] },
      quality: { type: 'string', enum: ['low', 'medium', 'high'] },
      brandMode: { type: 'string', enum: ['none', 'visual_identity', 'full_brand'] },
      regenerateBase: { type: 'boolean' },
      replaceTextLayers: { type: 'boolean' },
      sourceArtifactId: { type: 'string' },
      logo: { type: 'object', additionalProperties: false, properties: {
        enabled: { type: 'boolean' },
        anchor: { type: 'string', enum: ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'] },
        widthPercent: { type: 'number', minimum: 4, maximum: 30 },
        marginPercent: { type: 'number', minimum: 1, maximum: 12 },
        contrastTreatment: { type: 'string', enum: ['none','light','dark'] }
      }, required: ['enabled','anchor','widthPercent','marginPercent','contrastTreatment'] },
      textBlocks: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, text: { type: 'string' },
          anchor: { type: 'string', enum: ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'] },
          widthPercent: { type: 'number', minimum: 10, maximum: 90 },
          fontSizePercent: { type: 'number', minimum: 1, maximum: 12 },
          color: { type: 'string' }, align: { type: 'string', enum: ['left','center','right'] } },
        required: ['id','text','anchor','widthPercent','fontSizePercent','color','align'] } },
      shapeBlocks: { type: 'array', maxItems: 12, items: { type: 'object', additionalProperties: false,
        properties: { id: { type: 'string' }, shape: { type: 'string', enum: ['rectangle','ellipse'] },
          anchor: { type: 'string', enum: ['top-left','top-center','top-right','center-left','center','center-right','bottom-left','bottom-center','bottom-right'] },
          widthPercent: { type: 'number', minimum: 2, maximum: 100 },
          heightPercent: { type: 'number', minimum: 2, maximum: 100 },
          color: { type: 'string' }, opacity: { type: 'number', minimum: 0.05, maximum: 1 },
          rotation: { type: 'number', minimum: -180, maximum: 180 } },
        required: ['id','shape','anchor','widthPercent','heightPercent','color','opacity','rotation'] } }
    },
    required: ['action','title','prompt','format','preset','quality','brandMode','regenerateBase','replaceTextLayers',
      'sourceArtifactId','logo','textBlocks','shapeBlocks']
  }
});

async function executarGerarImagem(argumentos, dependencias = {}) {
  if (!dependencias.servicoImagens || !dependencias.conversationId || !dependencias.turnoIA?.id) {
    const erro = new Error('O serviço de imagens não está disponível neste turno.');
    erro.codigo = 'IMAGE_SERVICE_UNAVAILABLE'; throw erro;
  }
  const patch = dependencias.imageContext?.compositionPatch || {};
  const spec = { ...argumentos,
    ...(dependencias.imageOutputFormat ? { format: dependencias.imageOutputFormat } : {}),
    logo: { ...argumentos.logo,
    ...(patch.logoAnchor ? { anchor: patch.logoAnchor } : {}),
    ...(patch.logoWidthPercent ? { widthPercent: patch.logoWidthPercent } : {}),
    ...(patch.logoMarginPercent ? { marginPercent: patch.logoMarginPercent } : {})
  } };
  return dependencias.servicoImagens.gerar(dependencias.conversationId,
    dependencias.turnoIA.id, spec, {
      departmentId: dependencias.departamentoId || null,
      classification: dependencias.imageClassification || 'conversa_privada',
      mode: dependencias.imageGenerationMode,
      imageContext: dependencias.imageContext || null,
      onStage: dependencias.onImageStage
    });
}

module.exports = { definicaoGerarImagem, executarGerarImagem };
