import argparse
import configparser
from src.server.datacannon import DataCannon


########################################################################
# MAIN
########################################################################

def main():

    parser = argparse.ArgumentParser(description="DataCannon Server")
    parser.add_argument('config',
                        type=str,
                        help='Path to the configuration file')

    args = parser.parse_args()

    config = configparser.ConfigParser()
    config.read(args.config)

    host = config.get('DataCannon', 'host')
    port = config.getint('DataCannon', 'port')
    service_map = dict(config.items("DataCannon.Services"))
    server = DataCannon(host=host, port=port, service_map=service_map)
    server.serve_forever()


if __name__ == '__main__':
    main()
