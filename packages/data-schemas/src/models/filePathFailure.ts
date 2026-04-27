import filePathFailureSchema from '~/schema/filePathFailure';

/**
 * Creates or returns the FilePathFailure model using the provided mongoose
 * instance and schema.
 */
export function createFilePathFailureModel(mongoose: typeof import('mongoose')) {
  return (
    mongoose.models.FilePathFailure ||
    mongoose.model('FilePathFailure', filePathFailureSchema)
  );
}
