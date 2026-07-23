const state = {
  currentPatient: null,
  currentMode: 'create',
  currentPatientId: null,

  currentPhotoFile: null,
  currentPhotoDataUrl: '',
  cameraStream: null,

  miniTargetId: null,
  selectedStudyFiles: [],

  patientFormAbortController: null,
};

export { state };
