terraform {
  required_version = ">= 1.14.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
    external = {
      source  = "hashicorp/external"
      version = "2.4.2"
    }
    local = {
      source  = "hashicorp/local"
      version = "2.9.1"
    }
    null = {
      source  = "hashicorp/null"
      version = "3.3.2"
    }
    random = {
      source  = "hashicorp/random"
      version = "3.9.1"
    }
    time = {
      source  = "hashicorp/time"
      version = "0.14.2"
    }
  }
}
