# Copyright 2022 Hardfin, Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

ARG TAILSCALE_TAG=v1.34.0
FROM docker.io/tailscale/tailscale:${TAILSCALE_TAG}

COPY tailscale-entrypoint.sh /usr/local/bin/tailscale-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/tailscale-entrypoint.sh"]
