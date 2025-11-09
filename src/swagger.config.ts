import YAML from 'yamljs';
import path from 'path';

const swaggerYamlPath = path.join(__dirname, 'specification', 'swagger.yaml');
export const swaggerSpec = YAML.load(swaggerYamlPath);

